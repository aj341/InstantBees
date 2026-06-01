import type nodemailer from "nodemailer";

export type StoredEmailAttachment = {
  filename: string;
  contentType?: string | null;
  url?: string | null;
  contentBase64?: string | null;
  content?: string | null;
  cid?: string | null;
};

function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const valueText = String(value).trim();
  return valueText.length > 0 ? valueText : null;
}

function normalizeAttachment(value: unknown): StoredEmailAttachment | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const filename = text(raw["filename"] ?? raw["name"]);
  if (!filename) return null;
  const url = text(raw["url"] ?? raw["href"]);
  const contentBase64 = text(raw["contentBase64"] ?? raw["base64"]);
  const content = text(raw["content"] ?? raw["text"]);
  if (!url && !contentBase64 && !content) return null;
  return {
    filename,
    contentType: text(raw["contentType"] ?? raw["mimeType"]),
    url,
    contentBase64,
    content,
    cid: text(raw["cid"]),
  };
}

export function normalizeAttachments(value: unknown): StoredEmailAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeAttachment).filter((item): item is StoredEmailAttachment => !!item).slice(0, 10);
}

export function attachmentsJson(value: unknown): string | null {
  const attachments = normalizeAttachments(value);
  return attachments.length > 0 ? JSON.stringify(attachments) : null;
}

export function mergeAttachmentsJson(...values: Array<string | null | undefined>): string | null {
  const merged: StoredEmailAttachment[] = [];
  for (const value of values) {
    if (!value) continue;
    try {
      merged.push(...normalizeAttachments(JSON.parse(value)));
    } catch {
      // Ignore malformed legacy values rather than blocking sends.
    }
  }
  return merged.length > 0 ? JSON.stringify(merged.slice(0, 10)) : null;
}

export function mailAttachments(value: string | null | undefined): nodemailer.SendMailOptions["attachments"] {
  if (!value) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  const attachments = normalizeAttachments(parsed);
  if (attachments.length === 0) return undefined;
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    contentType: attachment.contentType ?? undefined,
    cid: attachment.cid ?? undefined,
    path: attachment.url ?? undefined,
    content: attachment.contentBase64
      ? Buffer.from(attachment.contentBase64, "base64")
      : attachment.content ?? undefined,
  }));
}
