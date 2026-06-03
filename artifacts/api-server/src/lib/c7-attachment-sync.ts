import fs from "node:fs";
import path from "node:path";
import { and, eq, like } from "drizzle-orm";
import {
  campaignsTable,
  db,
  sequenceStepsTable,
  sequenceStepVariantsTable,
} from "@workspace/db";
import type { StoredEmailAttachment } from "./email-attachments";

const ASSET_DIR = path.resolve(process.cwd(), "src/assets/c7");
const COVER_LETTER_FILENAME = "Graphic Designer Cover Letter - June 2026_compressed.pdf";
const RESUME_FILENAME = "Graphic Designer Resume - June 2026_compressed.pdf";

function pdfAttachment(filename: string): StoredEmailAttachment {
  const filePath = path.join(ASSET_DIR, filename);
  return {
    filename,
    contentType: "application/pdf",
    contentBase64: fs.readFileSync(filePath).toString("base64"),
  };
}

export async function syncC7JuneAttachments(): Promise<void> {
  const coverLetter = pdfAttachment(COVER_LETTER_FILENAME);
  const resume = pdfAttachment(RESUME_FILENAME);
  const coverOnlyJson = JSON.stringify([coverLetter]);
  const coverAndResumeJson = JSON.stringify([coverLetter, resume]);

  const campaigns = await db
    .select()
    .from(campaignsTable)
    .where(like(campaignsTable.name, "Campaign 7:%"));

  for (const campaign of campaigns) {
    const [firstStep] = await db
      .select()
      .from(sequenceStepsTable)
      .where(and(
        eq(sequenceStepsTable.campaignId, campaign.id),
        eq(sequenceStepsTable.stepNumber, 1),
      ));
    if (!firstStep) continue;

    await db
      .update(sequenceStepsTable)
      .set({ attachmentsJson: coverOnlyJson })
      .where(eq(sequenceStepsTable.id, firstStep.id));

    const variants = await db
      .select()
      .from(sequenceStepVariantsTable)
      .where(eq(sequenceStepVariantsTable.stepId, firstStep.id));

    for (const variant of variants) {
      const lowerName = variant.name.toLowerCase();
      const attachmentsJson = lowerName.includes("resume") && !lowerName.includes("no resume")
        ? coverAndResumeJson
        : coverOnlyJson;
      await db
        .update(sequenceStepVariantsTable)
        .set({ attachmentsJson })
        .where(eq(sequenceStepVariantsTable.id, variant.id));
    }
  }
}
