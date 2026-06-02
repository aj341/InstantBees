import { Router, type IRouter, type Request, type Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { eq, ilike } from "drizzle-orm";
import {
  db,
  campaignsTable,
  leadsTable,
  sequenceStepsTable,
  campaignLeadsTable,
  dailyStatsTable,
  emailAccountsTable,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { enqueueMissingCampaignJobs } from "../lib/campaign-enqueue.js";

const router: IRouter = Router();

// Keep track of active SSE transports keyed by session id
const transports = new Map<string, SSEServerTransport>();

function buildMcpServer(): Server {
  const server = new Server(
    { name: "outreach-io", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  // ── Tool: list_campaigns ───────────────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "list_campaigns",
        description: "List all email campaigns with their stats (sent, opens, replies, status).",
        inputSchema: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["draft", "active", "paused", "completed"],
              description: "Optional: filter by status",
            },
          },
        },
      },
      {
        name: "get_campaign_analytics",
        description:
          "Get detailed analytics for a specific campaign. You can look up the campaign by name or by id.",
        inputSchema: {
          type: "object",
          properties: {
            campaignId: { type: "number", description: "Campaign ID" },
            campaignName: {
              type: "string",
              description: "Campaign name (partial match, case-insensitive). Used if campaignId not provided.",
            },
          },
        },
      },
      {
        name: "upload_contacts",
        description:
          "Bulk-import contacts/leads into the app. Pass either a JSON array of lead objects or raw CSV text. Optionally add them all to a campaign. Returns how many were imported vs skipped (duplicates).",
        inputSchema: {
          type: "object",
          properties: {
            leads: {
              type: "array",
              description: "Array of lead objects",
              items: {
                type: "object",
                properties: {
                  email: { type: "string" },
                  firstName: { type: "string" },
                  lastName: { type: "string" },
                  company: { type: "string" },
                  title: { type: "string" },
                  website: { type: "string" },
                  phone: { type: "string" },
                },
                required: ["email"],
              },
            },
            csvText: {
              type: "string",
              description:
                "Raw CSV text with header row. Expected columns: email, firstName (or first_name), lastName (or last_name), company, title, website, phone",
            },
            campaignId: {
              type: "number",
              description: "Optional: add all imported leads to this campaign",
            },
            campaignName: {
              type: "string",
              description: "Optional: find campaign by name and add leads to it",
            },
          },
        },
      },
      {
        name: "build_email_sequence",
        description:
          "Create one or more email sequence steps for a campaign. Replaces the existing sequence if replaceExisting is true.",
        inputSchema: {
          type: "object",
          required: ["campaignId", "steps"],
          properties: {
            campaignId: { type: "number", description: "Campaign ID" },
            campaignName: {
              type: "string",
              description: "Campaign name (used if campaignId not known)",
            },
            replaceExisting: {
              type: "boolean",
              description: "If true, delete all existing steps before adding new ones",
            },
            steps: {
              type: "array",
              items: {
                type: "object",
                required: ["subject", "body"],
                properties: {
                  subject: { type: "string" },
                  body: { type: "string" },
                  bodyType: {
                    type: "string",
                    enum: ["text", "html"],
                    description: "plain text or HTML email body",
                  },
                  delayDays: {
                    type: "number",
                    description: "Days after the previous step (0 = same day)",
                  },
                },
              },
            },
          },
        },
      },
      {
        name: "create_campaign",
        description: "Create a new email campaign.",
        inputSchema: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
            fromName: { type: "string" },
            replyTo: { type: "string" },
            dailyLimit: { type: "number" },
            trackOpens: { type: "boolean" },
            trackClicks: { type: "boolean" },
          },
        },
      },
      {
        name: "get_overview",
        description:
          "Get a high-level overview of the account: total emails sent, open/reply rates, active campaigns, connected accounts.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }));

  // ── Tool execution ─────────────────────────────────────────────────────────
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;

    try {
      // ── list_campaigns ──────────────────────────────────────────────────
      if (name === "list_campaigns") {
        let campaigns = await db.select().from(campaignsTable).orderBy(campaignsTable.createdAt);
        if (args.status) {
          campaigns = campaigns.filter((c) => c.status === args.status);
        }
        const rows = campaigns.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          sent: c.sentCount,
          opens: c.openCount,
          replies: c.replyCount,
          leads: c.leadsCount,
          openRate: c.sentCount > 0 ? `${((c.openCount / c.sentCount) * 100).toFixed(1)}%` : "0%",
          replyRate: c.sentCount > 0 ? `${((c.replyCount / c.sentCount) * 100).toFixed(1)}%` : "0%",
        }));
        return {
          content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
        };
      }

      // ── get_campaign_analytics ──────────────────────────────────────────
      if (name === "get_campaign_analytics") {
        let campaign = null;
        if (args.campaignId) {
          const rows = await db
            .select()
            .from(campaignsTable)
            .where(eq(campaignsTable.id, Number(args.campaignId)));
          campaign = rows[0] ?? null;
        } else if (args.campaignName) {
          const rows = await db
            .select()
            .from(campaignsTable)
            .where(ilike(campaignsTable.name, `%${args.campaignName}%`));
          campaign = rows[0] ?? null;
        }
        if (!campaign) {
          return { content: [{ type: "text", text: "Campaign not found." }], isError: true };
        }
        const openRate = campaign.sentCount > 0 ? (campaign.openCount / campaign.sentCount) * 100 : 0;
        const replyRate = campaign.sentCount > 0 ? (campaign.replyCount / campaign.sentCount) * 100 : 0;
        const bounceRate = campaign.sentCount > 0 ? (campaign.bounceCount / campaign.sentCount) * 100 : 0;
        const analytics = {
          campaign: campaign.name,
          status: campaign.status,
          leads: campaign.leadsCount,
          sent: campaign.sentCount,
          opened: campaign.openCount,
          replied: campaign.replyCount,
          bounced: campaign.bounceCount,
          openRate: `${openRate.toFixed(1)}%`,
          replyRate: `${replyRate.toFixed(1)}%`,
          bounceRate: `${bounceRate.toFixed(1)}%`,
        };
        return { content: [{ type: "text", text: JSON.stringify(analytics, null, 2) }] };
      }

      // ── upload_contacts ─────────────────────────────────────────────────
      if (name === "upload_contacts") {
        type LeadRow = { email: string; firstName?: string; lastName?: string; company?: string; title?: string; website?: string; phone?: string };
        let rawLeads: LeadRow[] = [];

        if (args.csvText) {
          // parse CSV
          const lines = String(args.csvText).trim().split("\n");
          const headers = lines[0].split(",").map((h: string) => h.trim().toLowerCase().replace(/[^a-z]/g, ""));
          const emailIdx = headers.indexOf("email");
          const firstIdx = Math.max(headers.indexOf("firstname"), headers.indexOf("first_name".replace(/_/g, "")));
          const lastIdx = Math.max(headers.indexOf("lastname"), headers.indexOf("last_name".replace(/_/g, "")));
          const companyIdx = headers.indexOf("company");
          const titleIdx = headers.indexOf("title");
          const websiteIdx = headers.indexOf("website");
          const phoneIdx = headers.indexOf("phone");

          if (emailIdx === -1) {
            return { content: [{ type: "text", text: "CSV must have an 'email' column." }], isError: true };
          }

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
        } else if (Array.isArray(args.leads)) {
          rawLeads = args.leads as LeadRow[];
        }

        if (rawLeads.length === 0) {
          return { content: [{ type: "text", text: "No valid leads found to import." }], isError: true };
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
            if (row) {
              imported++;
              leadIds.push(row.id);
            } else {
              skipped++;
            }
          } catch {
            skipped++;
          }
        }

        // Optionally attach to campaign
        let campaignId: number | null = null;
        if (args.campaignId) {
          campaignId = Number(args.campaignId);
        } else if (args.campaignName) {
          const rows = await db
            .select()
            .from(campaignsTable)
            .where(ilike(campaignsTable.name, `%${args.campaignName}%`));
          campaignId = rows[0]?.id ?? null;
        }

        if (campaignId && leadIds.length > 0) {
          const rows = leadIds.map((lid) => ({ campaignId: campaignId!, leadId: lid }));
          await db.insert(campaignLeadsTable).values(rows).onConflictDoNothing();
          const count = await db.select().from(campaignLeadsTable).where(eq(campaignLeadsTable.campaignId, campaignId));
          const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId));
          if (campaign?.status === "active") {
            await enqueueMissingCampaignJobs(campaignId, { leadIds });
          }
          await db.update(campaignsTable).set({ leadsCount: count.length }).where(eq(campaignsTable.id, campaignId));
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  imported,
                  skipped,
                  total: rawLeads.length,
                  addedToCampaign: campaignId ?? null,
                  message: `Successfully imported ${imported} contacts. ${skipped} skipped (duplicates or invalid).`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // ── build_email_sequence ────────────────────────────────────────────
      if (name === "build_email_sequence") {
        let campaignId: number | null = args.campaignId ? Number(args.campaignId) : null;
        if (!campaignId && args.campaignName) {
          const rows = await db
            .select()
            .from(campaignsTable)
            .where(ilike(campaignsTable.name, `%${args.campaignName}%`));
          campaignId = rows[0]?.id ?? null;
        }
        if (!campaignId) {
          return { content: [{ type: "text", text: "Campaign not found." }], isError: true };
        }
        if (args.replaceExisting) {
          await db.delete(sequenceStepsTable).where(eq(sequenceStepsTable.campaignId, campaignId));
        }
        const existing = await db
          .select()
          .from(sequenceStepsTable)
          .where(eq(sequenceStepsTable.campaignId, campaignId));
        let stepNumber = existing.length + 1;
        const created = [];
        for (const step of (args.steps ?? []) as { subject: string; body: string; bodyType?: string; delayDays?: number }[]) {
          const [row] = await db
            .insert(sequenceStepsTable)
            .values({
              campaignId,
              stepNumber: stepNumber++,
              subject: step.subject,
              body: step.body,
              bodyType: step.bodyType ?? "text",
              delayDays: step.delayDays ?? 0,
            })
            .returning();
          created.push({ id: row.id, stepNumber: row.stepNumber, subject: row.subject });
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { created: created.length, steps: created, message: `Added ${created.length} sequence step(s) to campaign ${campaignId}.` },
                null,
                2
              ),
            },
          ],
        };
      }

      // ── create_campaign ─────────────────────────────────────────────────
      if (name === "create_campaign") {
        const [campaign] = await db
          .insert(campaignsTable)
          .values({
            name: String(args.name),
            fromName: args.fromName ? String(args.fromName) : null,
            replyTo: args.replyTo ? String(args.replyTo) : null,
            dailyLimit: args.dailyLimit ? Number(args.dailyLimit) : null,
            trackOpens: args.trackOpens !== false,
            trackClicks: args.trackClicks !== false,
          })
          .returning();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { id: campaign.id, name: campaign.name, status: campaign.status, message: `Campaign "${campaign.name}" created with ID ${campaign.id}.` },
                null,
                2
              ),
            },
          ],
        };
      }

      // ── get_overview ─────────────────────────────────────────────────
      if (name === "get_overview") {
        const campaigns = await db.select().from(campaignsTable);
        const accounts = await db.select().from(emailAccountsTable);
        const totalSent = campaigns.reduce((s, c) => s + c.sentCount, 0);
        const totalOpened = campaigns.reduce((s, c) => s + c.openCount, 0);
        const totalReplied = campaigns.reduce((s, c) => s + c.replyCount, 0);
        const totalBounced = campaigns.reduce((s, c) => s + c.bounceCount, 0);
        const overview = {
          campaigns: { total: campaigns.length, active: campaigns.filter(c => c.status === "active").length },
          accounts: { total: accounts.length, connected: accounts.filter(a => a.status === "connected").length },
          emails: {
            sent: totalSent,
            opened: totalOpened,
            replied: totalReplied,
            bounced: totalBounced,
            openRate: totalSent > 0 ? `${((totalOpened / totalSent) * 100).toFixed(1)}%` : "0%",
            replyRate: totalSent > 0 ? `${((totalReplied / totalSent) * 100).toFixed(1)}%` : "0%",
          },
        };
        return { content: [{ type: "text", text: JSON.stringify(overview, null, 2) }] };
      }

      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    } catch (err) {
      logger.error({ err, tool: name }, "MCP tool error");
      return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  });

  return server;
}

// SSE endpoint — Claude connects here
router.get("/mcp/sse", async (req: Request, res: Response): Promise<void> => {
  const server = buildMcpServer();
  const transport = new SSEServerTransport("/api/mcp/messages", res);
  transports.set(transport.sessionId, transport);

  res.on("close", () => {
    transports.delete(transport.sessionId);
  });

  await server.connect(transport);
  logger.info({ sessionId: transport.sessionId }, "MCP client connected");
});

// Message endpoint — Claude posts tool calls here
router.post("/mcp/messages", async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  await transport.handlePostMessage(req, res);
});

export default router;
