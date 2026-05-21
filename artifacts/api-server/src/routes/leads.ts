import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, leadsTable, campaignLeadsTable, campaignsTable, labelsTable, leadLabelsTable, type Lead, type Label } from "@workspace/db";
import {
  CreateLeadBody,
  UpdateLeadBody,
  UpdateLeadParams,
  DeleteLeadParams,
  ListCampaignLeadsParams,
  AddLeadsToCampaignParams,
  AddLeadsToCampaignBody,
  RemoveLeadFromCampaignParams,
  BulkImportLeadsBody,
} from "@workspace/api-zod";
import { parseLeadsCsv, type LeadRow } from "../lib/csv";

const router: IRouter = Router();

async function attachLabels<T extends Pick<Lead, "id">>(leads: T[]): Promise<(T & { labels: Label[] })[]> {
  if (leads.length === 0) return [];
  const ids = leads.map((l) => l.id);
  const rows = await db
    .select({
      leadId: leadLabelsTable.leadId,
      id: labelsTable.id,
      name: labelsTable.name,
      color: labelsTable.color,
      createdAt: labelsTable.createdAt,
    })
    .from(leadLabelsTable)
    .innerJoin(labelsTable, eq(leadLabelsTable.labelId, labelsTable.id))
    .where(inArray(leadLabelsTable.leadId, ids));
  const byLead = new Map<number, Label[]>();
  for (const r of rows) {
    const { leadId, ...lbl } = r;
    const list = byLead.get(leadId) ?? [];
    list.push(lbl as Label);
    byLead.set(leadId, list);
  }
  return leads.map((l) => ({ ...l, labels: byLead.get(l.id) ?? [] }));
}

router.get("/leads", async (_req, res): Promise<void> => {
  const leads = await db.select().from(leadsTable).orderBy(leadsTable.createdAt);
  res.json(await attachLabels(leads));
});

router.post("/leads/bulk", async (req, res): Promise<void> => {
  let rawLeads: LeadRow[] = [];
  let campaignId: number | undefined;

  const contentType = (req.headers["content-type"] ?? "").toLowerCase();
  const isCsvUpload = contentType.includes("text/csv") || contentType.includes("application/csv");

  if (isCsvUpload) {
    // Direct CSV upload via:
    //   curl -X POST -H "Content-Type: text/csv" --data-binary @leads.csv \
    //        '<host>/api/leads/bulk?campaignId=123'
    const csvText = typeof req.body === "string" ? req.body : "";
    if (!csvText.trim()) {
      res.status(400).json({ error: "Empty CSV body" });
      return;
    }
    const { leads, error } = parseLeadsCsv(csvText);
    if (error) {
      res.status(400).json({ error });
      return;
    }
    rawLeads = leads;

    const rawCampaignId = req.query["campaignId"];
    if (typeof rawCampaignId === "string" && rawCampaignId.length > 0) {
      // Strict: must be a positive integer with no extra characters.
      if (!/^[1-9]\d*$/.test(rawCampaignId)) {
        res.status(400).json({ error: "campaignId must be a positive integer" });
        return;
      }
      campaignId = parseInt(rawCampaignId, 10);
    }
  } else {
    const parsed = BulkImportLeadsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const hasLeads = Array.isArray(parsed.data.leads) && parsed.data.leads.length > 0;
    const hasCsv = typeof parsed.data.csvText === "string" && parsed.data.csvText.trim().length > 0;
    if (!hasLeads && !hasCsv) {
      res.status(400).json({ error: "Provide either 'leads' or 'csvText'" });
      return;
    }
    if (hasCsv) {
      const { leads, error } = parseLeadsCsv(parsed.data.csvText!);
      if (error) {
        res.status(400).json({ error });
        return;
      }
      rawLeads = leads;
    } else {
      rawLeads = parsed.data.leads as LeadRow[];
    }
    campaignId = parsed.data.campaignId ?? undefined;
  }

  let imported = 0;
  let skipped = 0;
  const leadIds: number[] = [];

  for (const lead of rawLeads) {
    if (!lead.email?.includes("@")) { skipped++; continue; }
    try {
      const [row] = await db
        .insert(leadsTable)
        .values({
          email: lead.email.toLowerCase().trim(),
          firstName: lead.firstName || null,
          lastName: lead.lastName || null,
          company: lead.company || null,
          title: lead.title || null,
          website: lead.website || null,
          phone: lead.phone || null,
        })
        .onConflictDoNothing()
        .returning();
      if (row) { imported++; leadIds.push(row.id); } else { skipped++; }
    } catch { skipped++; }
  }

  if (campaignId !== undefined && leadIds.length > 0) {
    const rows = leadIds.map((lid) => ({ campaignId: campaignId!, leadId: lid }));
    await db.insert(campaignLeadsTable).values(rows).onConflictDoNothing();
    const count = await db.select().from(campaignLeadsTable).where(eq(campaignLeadsTable.campaignId, campaignId));
    await db.update(campaignsTable).set({ leadsCount: count.length }).where(eq(campaignsTable.id, campaignId));
  }

  // Apply labels to all imported leads, if requested.
  const labelIds: number[] = (() => {
    if (isCsvUpload) {
      const raw = req.query["labelIds"];
      if (typeof raw === "string" && raw.length > 0) {
        return raw.split(",").map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n) && n > 0);
      }
      return [];
    }
    const body = req.body as { labelIds?: unknown };
    return Array.isArray(body?.labelIds)
      ? (body.labelIds as unknown[]).filter((n): n is number => typeof n === "number" && Number.isFinite(n))
      : [];
  })();

  if (labelIds.length > 0 && leadIds.length > 0) {
    const validLabels = await db.select({ id: labelsTable.id }).from(labelsTable).where(inArray(labelsTable.id, labelIds));
    const validIds = validLabels.map((v) => v.id);
    if (validIds.length > 0) {
      const linkRows = leadIds.flatMap((lid) => validIds.map((lblId) => ({ leadId: lid, labelId: lblId })));
      await db.insert(leadLabelsTable).values(linkRows).onConflictDoNothing();
    }
  }

  res.json({ imported, skipped, total: rawLeads.length, leadIds });
});

router.post("/leads", async (req, res): Promise<void> => {
  const parsed = CreateLeadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [lead] = await db.insert(leadsTable).values(parsed.data).returning();
  res.status(201).json({ ...lead, labels: [] });
});

router.patch("/leads/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateLeadParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateLeadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [lead] = await db.update(leadsTable).set(parsed.data).where(eq(leadsTable.id, params.data.id)).returning();
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  const [withLabels] = await attachLabels([lead]);
  res.json(withLabels);
});

router.delete("/leads/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteLeadParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [lead] = await db.delete(leadsTable).where(eq(leadsTable.id, params.data.id)).returning();
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/campaigns/:id/leads", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = ListCampaignLeadsParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const campaignLeads = await db
    .select({ lead: leadsTable })
    .from(campaignLeadsTable)
    .innerJoin(leadsTable, eq(campaignLeadsTable.leadId, leadsTable.id))
    .where(eq(campaignLeadsTable.campaignId, params.data.id));
  res.json(await attachLabels(campaignLeads.map(r => r.lead)));
});

router.post("/campaigns/:id/leads", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = AddLeadsToCampaignParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = AddLeadsToCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rows = parsed.data.leadIds.map(leadId => ({ campaignId: params.data.id, leadId }));
  await db.insert(campaignLeadsTable).values(rows).onConflictDoNothing();
  const count = await db
    .select()
    .from(campaignLeadsTable)
    .where(eq(campaignLeadsTable.campaignId, params.data.id));
  await db.update(campaignsTable).set({ leadsCount: count.length }).where(eq(campaignsTable.id, params.data.id));
  res.json({ added: parsed.data.leadIds.length });
});

router.delete("/campaigns/:id/leads/:leadId", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rawLeadId = Array.isArray(req.params.leadId) ? req.params.leadId[0] : req.params.leadId;
  const params = RemoveLeadFromCampaignParams.safeParse({ id: parseInt(rawId, 10), leadId: parseInt(rawLeadId, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(campaignLeadsTable).where(
    and(
      eq(campaignLeadsTable.campaignId, params.data.id),
      eq(campaignLeadsTable.leadId, params.data.leadId)
    )
  );
  const count = await db.select().from(campaignLeadsTable).where(eq(campaignLeadsTable.campaignId, params.data.id));
  await db.update(campaignsTable).set({ leadsCount: count.length }).where(eq(campaignsTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
