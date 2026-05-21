import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, leadsTable, campaignLeadsTable, campaignsTable } from "@workspace/db";
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

const router: IRouter = Router();

router.get("/leads", async (_req, res): Promise<void> => {
  const leads = await db.select().from(leadsTable).orderBy(leadsTable.createdAt);
  res.json(leads);
});

router.post("/leads/bulk", async (req, res): Promise<void> => {
  const parsed = BulkImportLeadsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  type LeadRow = { email: string; firstName?: string; lastName?: string; company?: string; title?: string; website?: string; phone?: string };
  let rawLeads: LeadRow[] = [];

  if (parsed.data.csvText) {
    const lines = parsed.data.csvText.trim().split("\n");
    const headers = lines[0].split(",").map((h: string) => h.trim().toLowerCase().replace(/[^a-z]/g, ""));
    const emailIdx = headers.indexOf("email");
    const firstIdx = Math.max(headers.indexOf("firstname"), headers.indexOf("firstname"));
    const lastIdx = Math.max(headers.indexOf("lastname"), headers.indexOf("lastname"));
    const companyIdx = headers.indexOf("company");
    const titleIdx = headers.indexOf("title");
    const websiteIdx = headers.indexOf("website");
    const phoneIdx = headers.indexOf("phone");
    if (emailIdx === -1) { res.status(400).json({ error: "CSV must have an 'email' column" }); return; }
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c: string) => c.trim().replace(/^"|"$/g, ""));
      const email = cols[emailIdx];
      if (!email || !email.includes("@")) continue;
      rawLeads.push({
        email,
        firstName: firstIdx >= 0 ? cols[firstIdx] || undefined : undefined,
        lastName: lastIdx >= 0 ? cols[lastIdx] || undefined : undefined,
        company: companyIdx >= 0 ? cols[companyIdx] || undefined : undefined,
        title: titleIdx >= 0 ? cols[titleIdx] || undefined : undefined,
        website: websiteIdx >= 0 ? cols[websiteIdx] || undefined : undefined,
        phone: phoneIdx >= 0 ? cols[phoneIdx] || undefined : undefined,
      });
    }
  } else {
    rawLeads = parsed.data.leads as LeadRow[];
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

  if (parsed.data.campaignId && leadIds.length > 0) {
    const rows = leadIds.map((lid) => ({ campaignId: parsed.data.campaignId!, leadId: lid }));
    await db.insert(campaignLeadsTable).values(rows).onConflictDoNothing();
    const count = await db.select().from(campaignLeadsTable).where(eq(campaignLeadsTable.campaignId, parsed.data.campaignId!));
    await db.update(campaignsTable).set({ leadsCount: count.length }).where(eq(campaignsTable.id, parsed.data.campaignId!));
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
  res.status(201).json(lead);
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
  res.json(lead);
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
  res.json(campaignLeads.map(r => r.lead));
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
