/**
 * Remote MCP server — streamable HTTP transport at /mcp
 * Auth: same CLAUDE_API_KEY bearer token (checked before reaching this handler)
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { eq, ilike, inArray } from "drizzle-orm";
import {
  db,
  campaignsTable,
  leadsTable,
  sequenceStepsTable,
  campaignLeadsTable,
  emailAccountsTable,
  emailTemplatesTable,
  leadListsTable,
  listLeadsTable,
  labelsTable,
  leadLabelsTable,
  type Lead,
  type Label,
} from "@workspace/db";
import { importEmailAccounts } from "../lib/account-import";
import { attachmentsJson } from "../lib/email-attachments";
import { enqueueMissingCampaignJobs } from "../lib/campaign-enqueue";

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

async function resolveLabelIds(raw: unknown): Promise<number[]> {
  if (!Array.isArray(raw)) return [];
  const ids = raw.map((n) => Number(n)).filter((n) => Number.isFinite(n));
  if (ids.length === 0) return [];
  const valid = await db.select({ id: labelsTable.id }).from(labelsTable).where(inArray(labelsTable.id, ids));
  return valid.map((v) => v.id);
}
import { logger } from "../lib/logger.js";
import { mcpAuth } from "../middleware/api-auth.js";

const router: IRouter = Router();

// ── Tool definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "upload_contacts",
    description: "Bulk-upload contacts (leads) to a list. Pass a JSON array of contact objects OR raw CSV text with header row. Optionally attach labels to every imported contact via labelIds. Returns added/skipped counts and labelsApplied. Deduplicates by email.",
    inputSchema: {
      type: "object",
      properties: {
        listId: { type: "number", description: "ID of the list to add contacts to" },
        contacts: {
          type: "array",
          description: "Array of contact objects",
          items: { type: "object", properties: { email: { type: "string" }, firstName: { type: "string" }, lastName: { type: "string" }, company: { type: "string" }, title: { type: "string" } }, required: ["email"] },
        },
        csvText: { type: "string", description: "Raw CSV text (header row required, must include 'email' column)" },
        labelIds: { type: "array", items: { type: "number" }, description: "Optional: label IDs to apply to every imported contact. Use list_labels / create_label to discover or create label IDs." },
      },
    },
  },
  {
    name: "create_label",
    description: "Create a label (or return the existing one if a label with this name already exists). Idempotent on name.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", description: "Label name (case-sensitive, must be unique)" },
        color: { type: "string", description: "Optional CSS color (hex, e.g. #06b6d4). Defaults to cyan if omitted." },
      },
    },
  },
  {
    name: "list_labels",
    description: "List all labels available for tagging contacts. Returns { data: [{id, name, color, createdAt}], total }.",
    inputSchema: { type: "object", properties: {} },
  },
  { name: "create_list", description: "Create a new contact list.", inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" }, description: { type: "string" } } } },
  { name: "list_lists", description: "List all contact lists.", inputSchema: { type: "object", properties: { limit: { type: "number" }, offset: { type: "number" } } } },
  {
    name: "list_contacts",
    description: "List contacts, optionally filtered by list, search query, and/or labels. Each contact includes its labels array.",
    inputSchema: { type: "object", properties: { listId: { type: "number" }, search: { type: "string" }, labelIds: { type: "array", items: { type: "number" }, description: "Optional: only return contacts that have ALL of these label IDs" }, limit: { type: "number" }, offset: { type: "number" } } },
  },
  {
    name: "update_contact",
    description: "Update a contact's fields.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "number" }, firstName: { type: "string" }, lastName: { type: "string" }, company: { type: "string" }, title: { type: "string" }, status: { type: "string", enum: ["active", "unsubscribed", "bounced", "replied"] } } },
  },
  { name: "delete_contact", description: "Delete a contact by ID.", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "number" } } } },
  {
    name: "create_template",
    description: "Create an email template with optional {{variable}} placeholders.",
    inputSchema: { type: "object", required: ["name", "subject", "body"], properties: { name: { type: "string" }, subject: { type: "string" }, body: { type: "string" }, bodyType: { type: "string", enum: ["text", "html"] } } },
  },
  { name: "list_templates", description: "List all email templates.", inputSchema: { type: "object", properties: { limit: { type: "number" }, offset: { type: "number" } } } },
  { name: "get_template", description: "Get a single template by ID.", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "number" } } } },
  {
    name: "update_template",
    description: "Update an email template.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "number" }, name: { type: "string" }, subject: { type: "string" }, body: { type: "string" }, bodyType: { type: "string", enum: ["text", "html"] } } },
  },
  { name: "delete_template", description: "Delete a template by ID.", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "number" } } } },
  {
    name: "create_campaign",
    description: "Create a new email campaign.",
    inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" }, fromName: { type: "string" }, replyTo: { type: "string" }, dailyLimit: { type: "number" }, trackOpens: { type: "boolean" }, trackClicks: { type: "boolean" } } },
  },
  { name: "list_campaigns", description: "List all campaigns with status and stats.", inputSchema: { type: "object", properties: { status: { type: "string", enum: ["draft", "active", "paused", "completed"] }, limit: { type: "number" }, offset: { type: "number" } } } },
  { name: "get_campaign", description: "Get full details of one campaign including sequence steps.", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "number" } } } },
  {
    name: "attach_list_to_campaign",
    description: "Attach a contact list to a campaign, adding all list members to the campaign.",
    inputSchema: { type: "object", required: ["campaignId", "listId"], properties: { campaignId: { type: "number" }, listId: { type: "number" } } },
  },
  {
    name: "set_sequence_steps",
    description: "Replace all sequence steps for a campaign. Each step has subject, body, bodyType (text|html), and delayDays.",
    inputSchema: { type: "object", required: ["campaignId", "steps"], properties: { campaignId: { type: "number" }, steps: { type: "array", items: { type: "object", required: ["subject", "body"], properties: { subject: { type: "string" }, body: { type: "string" }, bodyType: { type: "string", enum: ["text", "html"] }, delayDays: { type: "number" } } } } } },
  },
  { name: "start_campaign", description: "Start (activate) a campaign.", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "number" } } } },
  { name: "pause_campaign", description: "Pause a campaign.", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "number" } } } },
  { name: "stop_campaign", description: "Stop (complete) a campaign.", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "number" } } } },
  { name: "list_mailboxes", description: "List all connected sending mailboxes/accounts and their status.", inputSchema: { type: "object", properties: { limit: { type: "number" }, offset: { type: "number" } } } },
  {
    name: "bulk_import_mailboxes",
    description: "Bulk import sending mailboxes from CSV text or a JSON accounts array. Passwords are encrypted and duplicates are skipped.",
    inputSchema: {
      type: "object",
      properties: {
        csvText: { type: "string" },
        defaultProvider: { type: "string", enum: ["gmail", "outlook", "smtp"] },
        accounts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              email: { type: "string" },
              name: { type: "string" },
              provider: { type: "string", enum: ["gmail", "outlook", "smtp"] },
              smtpPassword: { type: "string" },
              warmupEnabled: { type: "boolean" },
              dailySendLimit: { type: "number" },
              smtpHost: { type: "string" },
              smtpPort: { type: "number" },
              smtpUsername: { type: "string" },
              imapHost: { type: "string" },
              imapPort: { type: "number" },
            },
          },
        },
      },
    },
  },
  {
    name: "set_sending_limits",
    description: "Set daily sending limit and warmup toggle for a mailbox.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "number" }, dailySendLimit: { type: "number" }, warmupEnabled: { type: "boolean" } } },
  },
  { name: "get_campaign_stats", description: "Get per-campaign analytics: sent, opened, replied, bounced, rates, and per-step breakdown.", inputSchema: { type: "object", required: ["campaignId"], properties: { campaignId: { type: "number" } } } },
  { name: "analytics_overview", description: "Get global account-level analytics: campaign counts by status, and aggregate email totals (sent, opened, replied, bounced) with overall open/reply/bounce rates.", inputSchema: { type: "object", properties: {} } },
];

// ── Server factory ──────────────────────────────────────────────────────────

function buildServer(): Server {
  const server = new Server({ name: "outreach-io-remote", version: "2.0.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: a = {} } = req.params;
    try {
      return { content: [{ type: "text", text: JSON.stringify(await dispatch(name, a), null, 2) }] };
    } catch (err) {
      logger.error({ err, tool: name }, "MCP HTTP tool error");
      return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  });

  return server;
}

// ── Tool dispatcher ─────────────────────────────────────────────────────────

async function dispatch(name: string, a: Record<string, unknown>): Promise<unknown> {
  // ── Lists ──────────────────────────────────────────────────────────────
  if (name === "create_list") {
    const [row] = await db.insert(leadListsTable).values({ name: String(a.name), description: a.description ? String(a.description) : null }).returning();
    return row;
  }

  if (name === "list_lists") {
    const limit = Math.min(Number(a.limit ?? 50), 500);
    const offset = Number(a.offset ?? 0);
    const all = await db.select().from(leadListsTable).orderBy(leadListsTable.createdAt);
    return { data: all.slice(offset, offset + limit), total: all.length };
  }

  // ── Contacts ───────────────────────────────────────────────────────────
  if (name === "upload_contacts") {
    type Row = { email: string; firstName?: string; lastName?: string; company?: string; title?: string };
    let raw: Row[] = [];

    if (a.csvText && typeof a.csvText === "string") {
      const lines = a.csvText.trim().split("\n");
      const hdrs = lines[0].split(",").map((h: string) => h.trim().toLowerCase().replace(/[^a-z]/g, ""));
      const ei = hdrs.indexOf("email");
      if (ei === -1) throw new Error("CSV must have an 'email' column");
      const gi = (n: string) => { const i = hdrs.indexOf(n); return i >= 0 ? i : -1; };
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map((c: string) => c.trim().replace(/^"|"$/g, ""));
        const email = cols[ei]; if (!email?.includes("@")) continue;
        raw.push({ email, firstName: gi("firstname") >= 0 ? cols[gi("firstname")] || undefined : undefined, lastName: gi("lastname") >= 0 ? cols[gi("lastname")] || undefined : undefined, company: gi("company") >= 0 ? cols[gi("company")] || undefined : undefined, title: gi("title") >= 0 ? cols[gi("title")] || undefined : undefined });
      }
    } else if (Array.isArray(a.contacts)) {
      raw = a.contacts as Row[];
    } else throw new Error("Provide 'contacts' array or 'csvText' string");

    let added = 0, skipped = 0;
    const addedIds: number[] = [];
    for (const c of raw) {
      if (!c.email?.includes("@")) { skipped++; continue; }
      try {
        const [row] = await db.insert(leadsTable).values({ email: c.email.toLowerCase().trim(), firstName: c.firstName || null, lastName: c.lastName || null, company: c.company || null, title: c.title || null }).onConflictDoNothing().returning();
        if (row) { added++; addedIds.push(row.id); } else {
          const ex = await db.select().from(leadsTable).where(eq(leadsTable.email, c.email.toLowerCase().trim()));
          if (ex[0]) addedIds.push(ex[0].id);
          skipped++;
        }
      } catch { skipped++; }
    }
    if (a.listId && addedIds.length > 0) {
      await db.insert(listLeadsTable).values(addedIds.map(lid => ({ listId: Number(a.listId), leadId: lid }))).onConflictDoNothing();
    }
    const validLabelIds = await resolveLabelIds(a.labelIds);
    let labelsApplied = 0;
    if (validLabelIds.length > 0 && addedIds.length > 0) {
      const linkRows = addedIds.flatMap((lid) => validLabelIds.map((labelId) => ({ leadId: lid, labelId })));
      await db.insert(leadLabelsTable).values(linkRows).onConflictDoNothing();
      labelsApplied = validLabelIds.length;
    }
    return { added, skipped, total: raw.length, labelsApplied, message: `Imported ${added} contacts, skipped ${skipped} duplicates/invalid.` };
  }

  // ── Labels ─────────────────────────────────────────────────────────────
  if (name === "create_label") {
    const trimmed = String(a.name ?? "").trim();
    if (!trimmed) throw new Error("'name' is required");
    const existing = await db.select().from(labelsTable).where(eq(labelsTable.name, trimmed));
    if (existing[0]) return existing[0];
    const color = (typeof a.color === "string" && a.color) || "#06b6d4";
    const [row] = await db.insert(labelsTable).values({ name: trimmed, color }).returning();
    return row;
  }

  if (name === "list_labels") {
    const rows = await db.select().from(labelsTable).orderBy(labelsTable.name);
    return { data: rows, total: rows.length };
  }

  if (name === "list_contacts") {
    const limit = Math.min(Number(a.limit ?? 50), 500);
    const offset = Number(a.offset ?? 0);
    const search = String(a.search ?? "").trim();
    let contacts = await db.select().from(leadsTable).orderBy(leadsTable.createdAt);
    if (a.listId) {
      const members = await db.select().from(listLeadsTable).where(eq(listLeadsTable.listId, Number(a.listId)));
      const ids = new Set(members.map(m => m.leadId));
      contacts = contacts.filter(c => ids.has(c.id));
    }
    if (search) {
      const q = search.toLowerCase();
      contacts = contacts.filter(c => c.email.toLowerCase().includes(q) || c.firstName?.toLowerCase().includes(q) || c.company?.toLowerCase().includes(q));
    }
    if (Array.isArray(a.labelIds) && a.labelIds.length > 0) {
      const ids = (a.labelIds as unknown[]).map((n) => Number(n)).filter((n) => Number.isFinite(n));
      if (ids.length > 0) {
        const links = await db.select().from(leadLabelsTable).where(inArray(leadLabelsTable.labelId, ids));
        const countByLead = new Map<number, number>();
        for (const l of links) countByLead.set(l.leadId, (countByLead.get(l.leadId) ?? 0) + 1);
        contacts = contacts.filter((c) => (countByLead.get(c.id) ?? 0) === ids.length);
      }
    }
    const page = contacts.slice(offset, offset + limit);
    return { data: await attachLabelsToContacts(page), total: contacts.length };
  }

  if (name === "update_contact") {
    const id = Number(a.id);
    const update: Record<string, unknown> = {};
    if (a.firstName !== undefined) update.firstName = a.firstName || null;
    if (a.lastName !== undefined) update.lastName = a.lastName || null;
    if (a.company !== undefined) update.company = a.company || null;
    if (a.title !== undefined) update.title = a.title || null;
    if (a.status !== undefined) update.status = a.status;
    const [row] = await db.update(leadsTable).set(update).where(eq(leadsTable.id, id)).returning();
    if (!row) throw new Error("Contact not found");
    return row;
  }

  if (name === "delete_contact") {
    const id = Number(a.id);
    await db.delete(listLeadsTable).where(eq(listLeadsTable.leadId, id));
    await db.delete(campaignLeadsTable).where(eq(campaignLeadsTable.leadId, id));
    await db.delete(leadsTable).where(eq(leadsTable.id, id));
    return { deleted: true, id };
  }

  // ── Templates ──────────────────────────────────────────────────────────
  if (name === "create_template") {
    const [row] = await db.insert(emailTemplatesTable).values({ name: String(a.name), subject: String(a.subject), body: String(a.body), bodyType: String(a.bodyType ?? "text"), attachmentsJson: attachmentsJson(a.attachments) }).returning();
    return row;
  }
  if (name === "list_templates") {
    const limit = Math.min(Number(a.limit ?? 50), 500);
    const offset = Number(a.offset ?? 0);
    const all = await db.select().from(emailTemplatesTable).orderBy(emailTemplatesTable.createdAt);
    return { data: all.slice(offset, offset + limit), total: all.length };
  }
  if (name === "get_template") {
    const rows = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, Number(a.id)));
    if (!rows[0]) throw new Error("Template not found");
    return rows[0];
  }
  if (name === "update_template") {
    const id = Number(a.id);
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (a.name !== undefined) update.name = a.name;
    if (a.subject !== undefined) update.subject = a.subject;
    if (a.body !== undefined) update.body = a.body;
    if (a.bodyType !== undefined) update.bodyType = a.bodyType;
    if (a.attachments !== undefined) update.attachmentsJson = attachmentsJson(a.attachments);
    const [row] = await db.update(emailTemplatesTable).set(update).where(eq(emailTemplatesTable.id, id)).returning();
    if (!row) throw new Error("Template not found");
    return row;
  }
  if (name === "delete_template") {
    await db.delete(emailTemplatesTable).where(eq(emailTemplatesTable.id, Number(a.id)));
    return { deleted: true, id: Number(a.id) };
  }

  // ── Campaigns ──────────────────────────────────────────────────────────
  if (name === "create_campaign") {
    const [row] = await db.insert(campaignsTable).values({ name: String(a.name), fromName: a.fromName ? String(a.fromName) : null, replyTo: a.replyTo ? String(a.replyTo) : null, dailyLimit: a.dailyLimit ? Number(a.dailyLimit) : null, trackOpens: a.trackOpens !== false, trackClicks: a.trackClicks !== false }).returning();
    return row;
  }
  if (name === "list_campaigns") {
    const limit = Math.min(Number(a.limit ?? 50), 500);
    const offset = Number(a.offset ?? 0);
    let all = await db.select().from(campaignsTable).orderBy(campaignsTable.createdAt);
    if (a.status) all = all.filter(c => c.status === a.status);
    const page = all.slice(offset, offset + limit).map(c => ({
      ...c,
      openRate: c.sentCount > 0 ? parseFloat(((c.openCount / c.sentCount) * 100).toFixed(1)) : 0,
      replyRate: c.sentCount > 0 ? parseFloat(((c.replyCount / c.sentCount) * 100).toFixed(1)) : 0,
    }));
    return { data: page, total: all.length };
  }
  if (name === "get_campaign") {
    const rows = await db.select().from(campaignsTable).where(eq(campaignsTable.id, Number(a.id)));
    if (!rows[0]) throw new Error("Campaign not found");
    const steps = await db.select().from(sequenceStepsTable).where(eq(sequenceStepsTable.campaignId, Number(a.id))).orderBy(sequenceStepsTable.stepNumber);
    return { ...rows[0], steps };
  }
  if (name === "attach_list_to_campaign") {
    const members = await db.select().from(listLeadsTable).where(eq(listLeadsTable.listId, Number(a.listId)));
    if (members.length > 0) await db.insert(campaignLeadsTable).values(members.map(m => ({ campaignId: Number(a.campaignId), leadId: m.leadId }))).onConflictDoNothing();
    const all = await db.select().from(campaignLeadsTable).where(eq(campaignLeadsTable.campaignId, Number(a.campaignId)));
    const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, Number(a.campaignId)));
    let jobsCreated = 0;
    if (campaign?.status === "active" && members.length > 0) {
      jobsCreated = (await enqueueMissingCampaignJobs(Number(a.campaignId), { leadIds: members.map((member) => member.leadId) })).jobsCreated;
    }
    await db.update(campaignsTable).set({ leadsCount: all.length }).where(eq(campaignsTable.id, Number(a.campaignId)));
    return { campaignId: Number(a.campaignId), listId: Number(a.listId), addedLeads: members.length, totalLeads: all.length, jobsCreated };
  }
  if (name === "set_sequence_steps") {
    const cid = Number(a.campaignId);
    await db.delete(sequenceStepsTable).where(eq(sequenceStepsTable.campaignId, cid));
    const steps = (a.steps ?? []) as { subject: string; body: string; bodyType?: string; delayDays?: number; attachments?: unknown }[];
    const created = [];
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (!s.subject || !s.body) continue;
      const [row] = await db.insert(sequenceStepsTable).values({ campaignId: cid, stepNumber: i + 1, subject: s.subject, body: s.body, bodyType: s.bodyType ?? "text", attachmentsJson: attachmentsJson(s.attachments), delayDays: s.delayDays ?? 0 }).returning();
      created.push(row);
    }
    return { created: created.length, steps: created, message: `Set ${created.length} sequence step(s) on campaign ${cid}.` };
  }
  if (name === "start_campaign") {
    const [row] = await db.update(campaignsTable).set({ status: "active" }).where(eq(campaignsTable.id, Number(a.id))).returning();
    if (!row) throw new Error("Campaign not found");
    return { id: row.id, status: row.status };
  }
  if (name === "pause_campaign") {
    const [row] = await db.update(campaignsTable).set({ status: "paused" }).where(eq(campaignsTable.id, Number(a.id))).returning();
    if (!row) throw new Error("Campaign not found");
    return { id: row.id, status: row.status };
  }
  if (name === "stop_campaign") {
    const [row] = await db.update(campaignsTable).set({ status: "completed" }).where(eq(campaignsTable.id, Number(a.id))).returning();
    if (!row) throw new Error("Campaign not found");
    return { id: row.id, status: row.status };
  }

  // ── Mailboxes ──────────────────────────────────────────────────────────
  if (name === "list_mailboxes") {
    const limit = Math.min(Number(a.limit ?? 50), 500);
    const offset = Number(a.offset ?? 0);
    const all = await db.select().from(emailAccountsTable).orderBy(emailAccountsTable.createdAt);
    return { data: all.slice(offset, offset + limit), total: all.length };
  }
  if (name === "bulk_import_mailboxes") {
    return importEmailAccounts(a);
  }
  if (name === "set_sending_limits") {
    const id = Number(a.id);
    const update: Record<string, unknown> = {};
    if (a.dailySendLimit !== undefined) update.dailySendLimit = Number(a.dailySendLimit);
    if (a.warmupEnabled !== undefined) update.warmupEnabled = Boolean(a.warmupEnabled);
    const [row] = await db.update(emailAccountsTable).set(update).where(eq(emailAccountsTable.id, id)).returning();
    if (!row) throw new Error("Mailbox not found");
    return row;
  }

  // ── Analytics ──────────────────────────────────────────────────────────
  if (name === "get_campaign_stats") {
    const id = Number(a.campaignId);
    const rows = await db.select().from(campaignsTable).where(eq(campaignsTable.id, id));
    if (!rows[0]) throw new Error("Campaign not found");
    const c = rows[0];
    const steps = await db.select().from(sequenceStepsTable).where(eq(sequenceStepsTable.campaignId, id)).orderBy(sequenceStepsTable.stepNumber);
    return {
      campaignId: c.id, name: c.name, status: c.status, leads: c.leadsCount,
      sent: c.sentCount, opened: c.openCount, replied: c.replyCount, bounced: c.bounceCount,
      openRate: c.sentCount > 0 ? parseFloat(((c.openCount / c.sentCount) * 100).toFixed(1)) : 0,
      replyRate: c.sentCount > 0 ? parseFloat(((c.replyCount / c.sentCount) * 100).toFixed(1)) : 0,
      bounceRate: c.sentCount > 0 ? parseFloat(((c.bounceCount / c.sentCount) * 100).toFixed(1)) : 0,
      steps: steps.map(s => ({ stepNumber: s.stepNumber, subject: s.subject, delayDays: s.delayDays })),
    };
  }

  // ── Global analytics overview ───────────────────────────────────────────
  if (name === "analytics_overview") {
    const campaigns = await db.select().from(campaignsTable);
    const sent = campaigns.reduce((s, c) => s + c.sentCount, 0);
    const opened = campaigns.reduce((s, c) => s + c.openCount, 0);
    const replied = campaigns.reduce((s, c) => s + c.replyCount, 0);
    const bounced = campaigns.reduce((s, c) => s + c.bounceCount, 0);
    return {
      campaigns: {
        total: campaigns.length,
        active: campaigns.filter(c => c.status === "active").length,
        draft: campaigns.filter(c => c.status === "draft").length,
        paused: campaigns.filter(c => c.status === "paused").length,
        completed: campaigns.filter(c => c.status === "completed").length,
      },
      emails: {
        sent, opened, replied, bounced,
        openRate: sent > 0 ? parseFloat(((opened / sent) * 100).toFixed(1)) : 0,
        replyRate: sent > 0 ? parseFloat(((replied / sent) * 100).toFixed(1)) : 0,
        bounceRate: sent > 0 ? parseFloat(((bounced / sent) * 100).toFixed(1)) : 0,
      },
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}

// ── Route handlers ──────────────────────────────────────────────────────────

router.all("/mcp", mcpAuth, async (req: Request, res: Response): Promise<void> => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logger.error({ err }, "MCP HTTP request error");
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  } finally {
    await transport.close();
    await server.close();
  }
});

export default router;
