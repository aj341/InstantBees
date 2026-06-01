import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  campaignLeadsTable,
  campaignsTable,
  db,
  emailTemplatesTable,
  labelsTable,
  leadLabelsTable,
  leadListsTable,
  listLeadsTable,
  sequenceStepsTable,
  sequenceStepVariantsTable,
} from "@workspace/db";
import { attachmentsJson, mergeAttachmentsJson } from "../../lib/email-attachments";
import { importContacts, type DuplicateMode } from "../../lib/contact-import";

const router: IRouter = Router();

function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const valueText = String(value).trim();
  return valueText.length > 0 ? valueText : null;
}

function positiveInt(value: unknown, fallback: number, max = 10_000): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function optionalInt(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function timeText(value: unknown, fallback: string): string {
  const valueText = text(value);
  return valueText && /^\d{1,2}:\d{2}$/.test(valueText) ? valueText : fallback;
}

function sendWindowDays(value: unknown): string {
  const source = Array.isArray(value) ? value.join(",") : text(value);
  const days = String(source ?? "mon,tue,wed,thu,fri")
    .split(",")
    .map((day) => day.trim().slice(0, 3).toLowerCase())
    .filter((day) => ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].includes(day));
  return (days.length > 0 ? days : ["mon", "tue", "wed", "thu", "fri"]).join(",");
}

async function upsertLabel(name: string, color?: unknown): Promise<number> {
  const trimmed = name.trim();
  const [existing] = await db.select().from(labelsTable).where(eq(labelsTable.name, trimmed));
  if (existing) return existing.id;
  const [label] = await db.insert(labelsTable).values({ name: trimmed, color: text(color) ?? "#06b6d4" }).returning();
  if (!label) throw new Error(`Failed to create label ${trimmed}`);
  return label.id;
}

async function resolveVariantLabelId(rawVariant: unknown): Promise<number | null> {
  const variant = rawVariant as { labelId?: unknown; labelName?: unknown; label?: unknown; color?: unknown } | null;
  if (!variant) return null;
  const explicitId = optionalInt(variant.labelId);
  if (explicitId) return explicitId;
  const labelName = text(variant.labelName) ?? text(variant.label);
  return labelName ? upsertLabel(labelName, variant.color) : null;
}

function duplicateMode(value: unknown): DuplicateMode {
  return value === "update" || value === "error" || value === "skip" ? value : "skip";
}

router.post("/campaign-packages", async (req, res): Promise<void> => {
  try {
    const body = req.body ?? {};
    const templatesInput = Array.isArray(body.templates) ? body.templates : [];
    const segmentsInput = Array.isArray(body.segments) ? body.segments : [];
    const campaignsInput = Array.isArray(body.campaigns) ? body.campaigns : [];
    if (templatesInput.length === 0 && segmentsInput.length === 0 && campaignsInput.length === 0) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "Provide templates, segments, or campaigns." } });
      return;
    }

    const templatesByName = new Map<string, typeof emailTemplatesTable.$inferSelect>();
    const createdTemplates = [];
    for (const templateInput of templatesInput) {
      const name = text(templateInput.name);
      const subject = text(templateInput.subject);
      const bodyText = text(templateInput.body);
      if (!name || !subject || !bodyText) continue;
      const values = {
        name,
        subject,
        previewText: text(templateInput.previewText),
        body: bodyText,
        bodyType: text(templateInput.bodyType) ?? "text",
        attachmentsJson: attachmentsJson(templateInput.attachments),
        updatedAt: new Date(),
      };
      const [existing] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.name, name));
      const [template] = existing
        ? await db.update(emailTemplatesTable).set(values).where(eq(emailTemplatesTable.id, existing.id)).returning()
        : await db.insert(emailTemplatesTable).values(values).returning();
      if (template) {
        templatesByName.set(name, template);
        createdTemplates.push(template);
      }
    }

    const allTemplates = await db.select().from(emailTemplatesTable);
    for (const template of allTemplates) templatesByName.set(template.name, template);

    const listsByName = new Map<string, number>();
    const segmentResults = [];
    for (const segmentInput of segmentsInput) {
      const name = text(segmentInput.name) ?? text(segmentInput.listName);
      if (!name) continue;
      const [list] = await db.insert(leadListsTable).values({
        name,
        description: text(segmentInput.description),
      }).returning();
      if (!list) continue;
      listsByName.set(name, list.id);

      const labelIds: number[] = [];
      if (Array.isArray(segmentInput.labels)) {
        for (const label of segmentInput.labels) {
          const labelName = typeof label === "string" ? label : text(label?.name);
          if (labelName) labelIds.push(await upsertLabel(labelName, typeof label === "object" ? label?.color : undefined));
        }
      }
      if (Array.isArray(segmentInput.labelNames)) {
        for (const labelName of segmentInput.labelNames) {
          const nameText = text(labelName);
          if (nameText) labelIds.push(await upsertLabel(nameText));
        }
      }

      const mode = duplicateMode(segmentInput.onDuplicate);
      const contactResult = await importContacts({
        contacts: Array.isArray(segmentInput.contacts) ? segmentInput.contacts : [],
        csvText: typeof segmentInput.csvText === "string" ? segmentInput.csvText : undefined,
        listId: list.id,
        onDuplicate: mode,
      });
      const leadIds = contactResult.leadIds;
      if (leadIds.length > 0) {
        if (labelIds.length > 0) {
          await db.insert(leadLabelsTable).values(leadIds.flatMap((leadId) => labelIds.map((labelId) => ({ leadId, labelId })))).onConflictDoNothing();
        }
      }
      segmentResults.push({
        id: list.id,
        name,
        added: contactResult.created,
        created: contactResult.created,
        updated: contactResult.updated,
        existing: contactResult.updated + contactResult.skipped,
        skipped: contactResult.skipped,
        failed: contactResult.failed,
        total: contactResult.total,
        onDuplicate: mode,
        leadIds,
        createdIds: contactResult.createdIds,
        updatedIds: contactResult.updatedIds,
        skippedContacts: contactResult.skippedContacts,
        failures: contactResult.failures,
        labelsApplied: labelIds.length,
      });
    }

    const createdCampaigns = [];
    for (const campaignInput of campaignsInput) {
      const name = text(campaignInput.name);
      if (!name) continue;
      const [campaign] = await db.insert(campaignsTable).values({
        name,
        fromName: text(campaignInput.fromName),
        replyTo: text(campaignInput.replyTo),
        dailyLimit: optionalInt(campaignInput.dailyLimit),
        batchSize: positiveInt(campaignInput.batchSize, 5),
        batchIntervalMinutes: positiveInt(campaignInput.batchIntervalMinutes, 60, 24 * 60),
        sendWindowStart: timeText(campaignInput.sendWindowStart ?? campaignInput.sendingHours?.start, "07:00"),
        sendWindowEnd: timeText(campaignInput.sendWindowEnd ?? campaignInput.sendingHours?.end, "19:00"),
        sendWindowTimezone: text(campaignInput.sendWindowTimezone ?? campaignInput.timezone) ?? "Australia/Sydney",
        sendWindowDays: sendWindowDays(campaignInput.sendWindowDays ?? campaignInput.sendingDays),
        trackOpens: campaignInput.trackOpens !== false,
        trackClicks: campaignInput.trackClicks !== false,
        includeUnsubscribe: campaignInput.includeUnsubscribe !== false,
        scheduledStartAt: text(campaignInput.scheduledStartAt) ? new Date(String(campaignInput.scheduledStartAt)) : null,
      }).returning();
      if (!campaign) continue;

      const segmentName = text(campaignInput.segmentName) ?? text(campaignInput.listName);
      const listId = optionalInt(campaignInput.listId) ?? (segmentName ? listsByName.get(segmentName) ?? null : null);
      let attachedLeads = 0;
      if (listId) {
        const members = await db.select().from(listLeadsTable).where(eq(listLeadsTable.listId, listId));
        if (members.length > 0) {
          await db.insert(campaignLeadsTable).values(members.map((member) => ({ campaignId: campaign.id, leadId: member.leadId }))).onConflictDoNothing();
        }
        attachedLeads = members.length;
        await db.update(campaignsTable).set({ leadsCount: attachedLeads }).where(eq(campaignsTable.id, campaign.id));
      }

      const steps = Array.isArray(campaignInput.steps) ? campaignInput.steps : [];
      const createdSteps = [];
      for (let index = 0; index < steps.length; index += 1) {
        const stepInput = steps[index];
        const templateName = text(stepInput.templateName);
        const template = templateName ? templatesByName.get(templateName) : null;
        const subject = text(stepInput.subject) ?? template?.subject;
        const bodyText = text(stepInput.body) ?? template?.body;
        if (!subject || !bodyText) continue;
        const [step] = await db.insert(sequenceStepsTable).values({
          campaignId: campaign.id,
          stepNumber: index + 1,
          subject,
          previewText: text(stepInput.previewText) ?? template?.previewText ?? null,
          body: bodyText,
          bodyType: text(stepInput.bodyType) ?? template?.bodyType ?? "text",
          attachmentsJson: mergeAttachmentsJson(template?.attachmentsJson, attachmentsJson(stepInput.attachments)),
          delayDays: optionalInt(stepInput.delayDays) ?? 0,
        }).returning();
        if (step) {
          const variants = Array.isArray(stepInput.variants) ? stepInput.variants : [];
          const createdVariants = [];
          for (let variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
            const variantInput = variants[variantIndex];
            const labelId = await resolveVariantLabelId(variantInput);
            if (!labelId) continue;
            const variantTemplateName = text(variantInput.templateName);
            const variantTemplate = variantTemplateName ? templatesByName.get(variantTemplateName) : null;
            const variantSubject = text(variantInput.subject) ?? variantTemplate?.subject;
            const variantBody = text(variantInput.body) ?? variantTemplate?.body;
            if (!variantSubject || !variantBody) continue;
            const [variant] = await db.insert(sequenceStepVariantsTable).values({
              stepId: step.id,
              labelId,
              name: text(variantInput.name) ?? text(variantInput.labelName) ?? `Variant ${variantIndex + 1}`,
              subject: variantSubject,
              previewText: text(variantInput.previewText) ?? variantTemplate?.previewText ?? null,
              body: variantBody,
              bodyType: text(variantInput.bodyType) ?? variantTemplate?.bodyType ?? "text",
              attachmentsJson: mergeAttachmentsJson(variantTemplate?.attachmentsJson, attachmentsJson(variantInput.attachments)),
              priority: optionalInt(variantInput.priority) ?? variants.length - variantIndex,
            }).onConflictDoUpdate({
              target: [sequenceStepVariantsTable.stepId, sequenceStepVariantsTable.labelId],
              set: {
                name: text(variantInput.name) ?? text(variantInput.labelName) ?? `Variant ${variantIndex + 1}`,
                subject: variantSubject,
                previewText: text(variantInput.previewText) ?? variantTemplate?.previewText ?? null,
                body: variantBody,
                bodyType: text(variantInput.bodyType) ?? variantTemplate?.bodyType ?? "text",
                attachmentsJson: mergeAttachmentsJson(variantTemplate?.attachmentsJson, attachmentsJson(variantInput.attachments)),
                priority: optionalInt(variantInput.priority) ?? variants.length - variantIndex,
              },
            }).returning();
            if (variant) createdVariants.push(variant);
          }
          createdSteps.push({ ...step, variants: createdVariants });
        }
      }

      createdCampaigns.push({ ...campaign, listId, attachedLeads, steps: createdSteps });
    }

    res.status(201).json({
      templates: { createdOrUpdated: createdTemplates.length, data: createdTemplates },
      segments: { created: segmentResults.length, data: segmentResults },
      campaigns: { created: createdCampaigns.length, data: createdCampaigns },
    });
  } catch (err) {
    res.status(400).json({ error: { code: "PACKAGE_IMPORT_FAILED", message: err instanceof Error ? err.message : "Package import failed" } });
  }
});

export default router;
