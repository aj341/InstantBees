import { Router, type IRouter } from "express";
import { eq, ilike, or, and, inArray } from "drizzle-orm";
import { db, leadsTable, leadListsTable, listLeadsTable, campaignLeadsTable, campaignsTable, labelsTable, leadLabelsTable, type Lead, type Label } from "@workspace/db";

async function attachLabelsToContacts<T extends Pick<Lead, "id">>(contacts: T[]): Promise<(T & { labels: Label[] })[]> {
  if (contacts.length === 0) return [];
  const ids = contacts.map((c) => c.id);
  const rows = await db
    .select({ leadId: leadLabelsTable.leadId, id: labelsTable.id, name: labelsTable.name, color: labelsTable.color, createdAt: labelsTable.createdAt })
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
  return contacts.map((c) => ({ ...c, labels: byLead.get(c.id) ?? [] }));
}

async function resolveLabelIds(rawLabelIds: unknown): Promise<number[]> {
  if (!Array.isArray(rawLabelIds)) return [];
  const ids = rawLabelIds.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  if (ids.length === 0) return [];
  const valid = await db.select({ id: labelsTable.id }).from(labelsTable).where(inArray(labelsTable.id, ids));
  return valid.map((v) => v.id);
}

const router: IRouter = Router();

// ── Lists ──────────────────────────────────────────────────────────────────

// POST /api/v1/lists
router.post("/lists", async (req, res): Promise<void> => {
  const { name, description } = req.body ?? {};
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: { code: "INVALID_INPUT", message: "'name' is required" } });
    return;
  }
  const [list] = await db.insert(leadListsTable).values({ name, description: description ?? null }).returning();
  res.status(201).json(list);
});

// GET /api/v1/lists
router.get("/lists", async (_req, res): Promise<void> => {
  const lists = await db.select().from(leadListsTable).orderBy(leadListsTable.createdAt);
  res.json({ data: lists, total: lists.length });
});

// GET /api/v1/lists/:listId
router.get("/lists/:listId", async (req, res): Promise<void> => {
  const listId = parseInt(req.params.listId, 10);
  const rows = await db.select().from(leadListsTable).where(eq(leadListsTable.id, listId));
  if (!rows[0]) { res.status(404).json({ error: { code: "NOT_FOUND", message: "List not found" } }); return; }
  const members = await db.select().from(listLeadsTable).where(eq(listLeadsTable.listId, listId));
  res.json({ ...rows[0], memberCount: members.length });
});

// DELETE /api/v1/lists/:listId
router.delete("/lists/:listId", async (req, res): Promise<void> => {
  const listId = parseInt(req.params.listId, 10);
  await db.delete(listLeadsTable).where(eq(listLeadsTable.listId, listId));
  await db.delete(leadListsTable).where(eq(leadListsTable.id, listId));
  res.status(204).end();
});

// ── Bulk upload contacts to a list ────────────────────────────────────────

// POST /api/v1/lists/:listId/contacts/bulk
router.post("/lists/:listId/contacts/bulk", async (req, res): Promise<void> => {
  const listId = parseInt(req.params.listId, 10);
  const listRows = await db.select().from(leadListsTable).where(eq(leadListsTable.id, listId));
  if (!listRows[0]) { res.status(404).json({ error: { code: "NOT_FOUND", message: "List not found" } }); return; }

  type Row = { email: string; firstName?: string; lastName?: string; company?: string; title?: string; website?: string; phone?: string };
  let rawContacts: Row[] = [];

  const { contacts, csvText, labelIds: rawLabelIds } = req.body ?? {};

  if (csvText && typeof csvText === "string") {
    const lines = csvText.trim().split("\n");
    const headers = lines[0].split(",").map((h: string) => h.trim().toLowerCase().replace(/[^a-z]/g, ""));
    const col = (name: string) => { const i = headers.indexOf(name); return i >= 0 ? i : -1; };
    const emailIdx = col("email");
    if (emailIdx === -1) { res.status(400).json({ error: { code: "INVALID_INPUT", message: "CSV must have an 'email' column" } }); return; }
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(",").map((c: string) => c.trim().replace(/^"|"$/g, ""));
      const email = cells[emailIdx];
      if (!email?.includes("@")) continue;
      rawContacts.push({
        email,
        firstName: col("firstname") >= 0 ? cells[col("firstname")] || undefined : undefined,
        lastName: col("lastname") >= 0 ? cells[col("lastname")] || undefined : undefined,
        company: col("company") >= 0 ? cells[col("company")] || undefined : undefined,
        title: col("title") >= 0 ? cells[col("title")] || undefined : undefined,
        website: col("website") >= 0 ? cells[col("website")] || undefined : undefined,
        phone: col("phone") >= 0 ? cells[col("phone")] || undefined : undefined,
      });
    }
  } else if (Array.isArray(contacts)) {
    rawContacts = contacts as Row[];
  } else {
    res.status(400).json({ error: { code: "INVALID_INPUT", message: "Provide 'contacts' array or 'csvText' string" } });
    return;
  }

  let added = 0, skipped = 0;
  const addedIds: number[] = [];

  for (const c of rawContacts) {
    if (!c.email?.includes("@")) { skipped++; continue; }
    try {
      const [row] = await db.insert(leadsTable)
        .values({ email: c.email.toLowerCase().trim(), firstName: c.firstName || null, lastName: c.lastName || null, company: c.company || null, title: c.title || null, website: c.website || null, phone: c.phone || null })
        .onConflictDoNothing()
        .returning();
      if (row) { added++; addedIds.push(row.id); } else {
        const existing = await db.select().from(leadsTable).where(eq(leadsTable.email, c.email.toLowerCase().trim()));
        if (existing[0]) addedIds.push(existing[0].id);
        skipped++;
      }
    } catch { skipped++; }
  }

  if (addedIds.length > 0) {
    await db.insert(listLeadsTable).values(addedIds.map(lid => ({ listId, leadId: lid }))).onConflictDoNothing();
  }

  // Apply labels to every contact that was added or already existed.
  const validLabelIds = await resolveLabelIds(rawLabelIds);
  let labelsApplied = 0;
  if (validLabelIds.length > 0 && addedIds.length > 0) {
    const linkRows = addedIds.flatMap((lid) => validLabelIds.map((labelId) => ({ leadId: lid, labelId })));
    await db.insert(leadLabelsTable).values(linkRows).onConflictDoNothing();
    labelsApplied = validLabelIds.length;
  }

  res.json({ added, skipped, total: rawContacts.length, labelsApplied });
});

// ── Contacts (leads) ───────────────────────────────────────────────────────

// GET /api/v1/contacts
router.get("/contacts", async (req, res): Promise<void> => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 500);
  const offset = parseInt(String(req.query.offset ?? "0"), 10);
  const search = String(req.query.search ?? "").trim();
  const listId = req.query.listId ? parseInt(String(req.query.listId), 10) : null;

  let contacts = await db.select().from(leadsTable).orderBy(leadsTable.createdAt);

  if (listId) {
    const members = await db.select().from(listLeadsTable).where(eq(listLeadsTable.listId, listId));
    const ids = new Set(members.map(m => m.leadId));
    contacts = contacts.filter(c => ids.has(c.id));
  }

  if (search) {
    const q = search.toLowerCase();
    contacts = contacts.filter(c =>
      c.email.toLowerCase().includes(q) ||
      c.firstName?.toLowerCase().includes(q) ||
      c.lastName?.toLowerCase().includes(q) ||
      c.company?.toLowerCase().includes(q)
    );
  }

  // Optional ?labelIds=1,2 filter — contact must have ALL given labels.
  if (req.query.labelIds) {
    const ids = String(req.query.labelIds).split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n));
    if (ids.length > 0) {
      const links = await db.select().from(leadLabelsTable).where(inArray(leadLabelsTable.labelId, ids));
      const countByLead = new Map<number, number>();
      for (const l of links) countByLead.set(l.leadId, (countByLead.get(l.leadId) ?? 0) + 1);
      contacts = contacts.filter((c) => (countByLead.get(c.id) ?? 0) === ids.length);
    }
  }

  const total = contacts.length;
  const page = contacts.slice(offset, offset + limit);
  res.json({ data: await attachLabelsToContacts(page), total, limit, offset });
});

// GET /api/v1/contacts/:id
router.get("/contacts/:id", async (req, res): Promise<void> => {
  const rows = await db.select().from(leadsTable).where(eq(leadsTable.id, parseInt(req.params.id, 10)));
  if (!rows[0]) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Contact not found" } }); return; }
  const [withLabels] = await attachLabelsToContacts([rows[0]]);
  res.json(withLabels);
});

// POST /api/v1/contacts
router.post("/contacts", async (req, res): Promise<void> => {
  const { email, firstName, lastName, company, title, website, phone, labelIds: rawLabelIds } = req.body ?? {};
  if (!email || !String(email).includes("@")) {
    res.status(400).json({ error: { code: "INVALID_INPUT", message: "Valid 'email' is required" } });
    return;
  }
  try {
    const [row] = await db.insert(leadsTable).values({ email: String(email).toLowerCase().trim(), firstName: firstName || null, lastName: lastName || null, company: company || null, title: title || null, website: website || null, phone: phone || null }).returning();
    const validLabelIds = await resolveLabelIds(rawLabelIds);
    if (validLabelIds.length > 0) {
      await db.insert(leadLabelsTable).values(validLabelIds.map((labelId) => ({ leadId: row.id, labelId }))).onConflictDoNothing();
    }
    const [withLabels] = await attachLabelsToContacts([row]);
    res.status(201).json(withLabels);
  } catch {
    res.status(409).json({ error: { code: "CONFLICT", message: "Email already exists" } });
  }
});

// PUT /api/v1/contacts/:id/labels — replace labels on a contact
router.put("/contacts/:id/labels", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { labelIds: rawLabelIds } = req.body ?? {};
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, id));
  if (!lead) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Contact not found" } }); return; }
  const validLabelIds = await resolveLabelIds(rawLabelIds);
  const result = await db.transaction(async (tx) => {
    await tx.delete(leadLabelsTable).where(eq(leadLabelsTable.leadId, id));
    if (validLabelIds.length > 0) {
      await tx.insert(leadLabelsTable).values(validLabelIds.map((labelId) => ({ leadId: id, labelId }))).onConflictDoNothing();
    }
    return await attachLabelsToContacts([lead]);
  });
  res.json(result[0]);
});

// ── Labels ─────────────────────────────────────────────────────────────────

// GET /api/v1/labels
router.get("/labels", async (_req, res): Promise<void> => {
  const rows = await db.select().from(labelsTable).orderBy(labelsTable.name);
  res.json({ data: rows, total: rows.length });
});

// POST /api/v1/labels — idempotent: returns existing label if name matches
router.post("/labels", async (req, res): Promise<void> => {
  const { name, color } = req.body ?? {};
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: { code: "INVALID_INPUT", message: "'name' is required" } });
    return;
  }
  const trimmed = name.trim();
  const existing = await db.select().from(labelsTable).where(eq(labelsTable.name, trimmed));
  if (existing[0]) { res.status(200).json(existing[0]); return; }
  const [row] = await db.insert(labelsTable).values({ name: trimmed, color: (typeof color === "string" && color) || "#06b6d4" }).returning();
  res.status(201).json(row);
});

// DELETE /api/v1/labels/:id
router.delete("/labels/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: { code: "INVALID_INPUT", message: "Invalid label id" } }); return; }
  await db.delete(labelsTable).where(eq(labelsTable.id, id));
  res.status(204).end();
});

// PATCH /api/v1/contacts/:id
router.patch("/contacts/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { firstName, lastName, company, title, website, phone, status } = req.body ?? {};
  const update: Record<string, unknown> = {};
  if (firstName !== undefined) update.firstName = firstName || null;
  if (lastName !== undefined) update.lastName = lastName || null;
  if (company !== undefined) update.company = company || null;
  if (title !== undefined) update.title = title || null;
  if (website !== undefined) update.website = website || null;
  if (phone !== undefined) update.phone = phone || null;
  if (status !== undefined) update.status = status;
  const [row] = await db.update(leadsTable).set(update).where(eq(leadsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Contact not found" } }); return; }
  res.json(row);
});

// DELETE /api/v1/contacts/:id
router.delete("/contacts/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  await db.delete(listLeadsTable).where(eq(listLeadsTable.leadId, id));
  await db.delete(campaignLeadsTable).where(eq(campaignLeadsTable.leadId, id));
  await db.delete(leadsTable).where(eq(leadsTable.id, id));
  res.status(204).end();
});

export default router;
