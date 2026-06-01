import nodemailer, { type Transporter } from "nodemailer";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import type { EmailAccount } from "@workspace/db";
import { decryptSecret } from "./crypto";
import { mailAttachments } from "./email-attachments";

export type AccountWithSecret = Pick<
  EmailAccount,
  "email" | "name" | "provider" | "smtpHost" | "smtpPort" | "smtpUsername" | "smtpPasswordEnc"
>;

const GMAIL = { smtp: { host: "smtp.gmail.com", port: 587 }, imap: { host: "imap.gmail.com", port: 993 } };
const OUTLOOK = { smtp: { host: "smtp.office365.com", port: 587 }, imap: { host: "outlook.office365.com", port: 993 } };

export function resolveSmtp(account: AccountWithSecret): { host: string; port: number; username: string; password: string } {
  if (!account.smtpPasswordEnc) {
    throw new Error("No SMTP password configured for this account");
  }
  let host = account.smtpHost;
  let port = account.smtpPort;
  if (!host || !port) {
    if (account.provider === "gmail") {
      host = host ?? GMAIL.smtp.host;
      port = port ?? GMAIL.smtp.port;
    } else if (account.provider === "outlook") {
      host = host ?? OUTLOOK.smtp.host;
      port = port ?? OUTLOOK.smtp.port;
    } else {
      throw new Error("SMTP host/port not configured");
    }
  }
  const username = account.smtpUsername || account.email;
  const password = decryptSecret(account.smtpPasswordEnc);
  return { host, port, username, password };
}

export function resolveImap(account: Pick<EmailAccount, "provider" | "imapHost" | "imapPort" | "email" | "smtpUsername" | "smtpPasswordEnc">): { host: string; port: number; username: string; password: string } | null {
  if (!account.smtpPasswordEnc) return null;
  let host = account.imapHost;
  let port = account.imapPort;
  if (!host || !port) {
    if (account.provider === "gmail") {
      host = host ?? GMAIL.imap.host;
      port = port ?? GMAIL.imap.port;
    } else if (account.provider === "outlook") {
      host = host ?? OUTLOOK.imap.host;
      port = port ?? OUTLOOK.imap.port;
    } else {
      return null;
    }
  }
  const username = account.smtpUsername || account.email;
  const password = decryptSecret(account.smtpPasswordEnc);
  return { host, port, username, password };
}

export function buildTransport(account: AccountWithSecret): Transporter {
  const { host, port, username, password } = resolveSmtp(account);
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user: username, pass: password },
  });
}

export interface SendInput {
  to: string;
  toName?: string | null;
  fromName?: string | null;
  replyTo?: string | null;
  subject: string;
  previewText?: string | null;
  body: string;
  bodyType: "text" | "html" | string;
  trackingToken?: string;
  unsubscribeToken?: string;
  publicBaseUrl?: string;
  messageId?: string;
  trackClicks?: boolean;
  attachmentsJson?: string | null;
}

const HTML_TAG_RE = /<\/?(?:p|div|span|br|a|b|i|u|strong|em|h[1-6]|ul|ol|li|table|tr|td|th|img|hr|body|html|font|center|blockquote)\b/i;
export function looksLikeHtml(body: string): boolean {
  return HTML_TAG_RE.test(body);
}

/**
 * Some legacy rows have HTML stored as entity-encoded text (e.g. pasted into a WYSIWYG
 * that escaped the source). Detect that case heuristically and decode it.
 */
const ENCODED_TAG_RE = /&lt;\s*(?:!doctype|html|body|head|p|div|span|br|a|table|h[1-6]|ul|ol|li|img|hr|strong|em)\b/i;
export function decodeHtmlEntitiesIfEncoded(body: string): string {
  // Only decode when the body looks entity-encoded AND contains no real HTML tags —
  // i.e. the legacy case where source HTML was pasted into a WYSIWYG that escaped it.
  // If real tags exist, the user likely intends any &lt;…&gt; literals to render as text.
  if (!ENCODED_TAG_RE.test(body)) return body;
  if (HTML_TAG_RE.test(body)) return body;
  return body
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export function generateTrackingToken(): string {
  return randomBytes(18).toString("base64url");
}

const TRACKING_SECRET = process.env["SESSION_SECRET"] ?? "";

/** Sign a click-tracking destination URL so it can't be tampered with. */
export function signClickUrl(token: string, url: string): string {
  return createHmac("sha256", TRACKING_SECRET).update(`${token}|${url}`).digest("base64url").slice(0, 22);
}

/** Verify a click signature in constant time. Returns true iff the signature matches. */
export function verifyClickSignature(token: string, url: string, sig: string): boolean {
  const expected = signClickUrl(token, url);
  if (expected.length !== sig.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch {
    return false;
  }
}

export function buildMessageId(account: AccountWithSecret): string {
  const local = randomBytes(12).toString("hex");
  const domain = account.email.split("@")[1] ?? "localhost";
  return `<${local}@${domain}>`;
}

const HTML_END_RE = /<\/body\s*>/i;
const LINK_RE = /<a\s+([^>]*?)href\s*=\s*(["'])([^"']+)\2([^>]*)>/gi;

/**
 * Rewrite all <a href="..."> links to point through /api/track/click/:token?u=ENCODED.
 * Skips mailto:, tel:, anchor (#) links, and links already pointing at the tracking endpoint.
 */
export function rewriteLinksForTracking(html: string, baseUrl: string, token: string): string {
  const trackPrefix = `${baseUrl}/api/track/click/${token}`;
  return html.replace(LINK_RE, (match, before: string, quote: string, url: string, after: string) => {
    if (/^(mailto:|tel:|#|javascript:)/i.test(url)) return match;
    if (!/^https?:\/\//i.test(url)) return match;
    if (url.startsWith(trackPrefix)) return match;
    const sig = signClickUrl(token, url);
    const wrapped = `${trackPrefix}?u=${encodeURIComponent(url)}&s=${sig}`;
    return `<a ${before}href=${quote}${wrapped}${quote}${after}>`;
  });
}

/**
 * Wrap a plain-text body in basic HTML so Gmail/Outlook render it as a single
 * coherent message instead of collapsing/clipping. Preserves blank lines.
 */
function wrapPlainTextAsHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const paragraphs = escaped.split(/\n{2,}/).map((p) => p.replace(/\n/g, "<br />"));
  return paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 1em 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.5;color:#222;">${p}</p>`,
    )
    .join("");
}

/**
 * Inject a hidden preheader (preview text) at the very top of the HTML body.
 * Most email clients (Gmail, Outlook, Apple Mail) show this snippet in the inbox list
 * next to the subject. The combination of `display:none` + the trailing whitespace
 * span is a well-known trick to keep the preview from leaking the surrounding body.
 */
function injectPreheader(html: string, previewText: string): string {
  if (!previewText) return html;
  const escaped = previewText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const preheader =
    `<div style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escaped}</div>` +
    `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${"&zwnj;&nbsp;".repeat(60)}</div>`;
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body([^>]*)>/i, `<body$1>${preheader}`);
  }
  return preheader + html;
}

function injectHtmlFooter(html: string, pixelUrl: string | null, unsubUrl: string | null): string {
  const footerParts: string[] = [];
  if (unsubUrl) {
    // Inline, single line of small grey text. No <hr>, no <div> block, no border —
    // Gmail otherwise treats the divider as a signature delimiter and hides the body
    // behind a "…" toggle.
    footerParts.push(
      `<p style="margin:2em 0 0 0;font-family:Arial,sans-serif;font-size:11px;color:#9ca3af;">` +
        `<a href="${unsubUrl}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a>` +
        `</p>`,
    );
  }
  if (pixelUrl) {
    footerParts.push(`<img src="${pixelUrl}" alt="" width="1" height="1" style="display:block;border:0;" />`);
  }
  const footer = footerParts.join("");
  if (!footer) return html;
  if (HTML_END_RE.test(html)) {
    return html.replace(HTML_END_RE, `${footer}</body>`);
  }
  return html + footer;
}

function buildTextFooter(text: string, unsubUrl: string | null): string {
  if (!unsubUrl) return text;
  // No "--" / "---" separator — those trigger Gmail's signature-trim heuristic and
  // hide the body. A plain blank line is enough.
  return `${text}\n\nUnsubscribe: ${unsubUrl}\n`;
}

export async function sendEmail(account: AccountWithSecret, input: SendInput): Promise<{ messageId: string }> {
  const transport = buildTransport(account);
  const displayName = input.fromName ?? account.name;
  const fromHeader = displayName ? `"${displayName}" <${account.email}>` : account.email;
  const toHeader = input.toName ? `"${input.toName}" <${input.to}>` : input.to;
  const baseUrl = input.publicBaseUrl;
  const pixelUrl = input.trackingToken && baseUrl
    ? `${baseUrl}/api/track/open/${input.trackingToken}.gif`
    : null;
  const unsubUrl = input.unsubscribeToken && baseUrl
    ? `${baseUrl}/api/unsubscribe/${input.unsubscribeToken}`
    : null;

  const isHtml = input.bodyType === "html" || looksLikeHtml(input.body);
  let bodyForSend = isHtml ? decodeHtmlEntitiesIfEncoded(input.body) : input.body;
  if (isHtml && input.trackClicks && input.trackingToken && baseUrl) {
    bodyForSend = rewriteLinksForTracking(bodyForSend, baseUrl, input.trackingToken);
  }
  const mailOptions: nodemailer.SendMailOptions = {
    from: fromHeader,
    to: toHeader,
    replyTo: input.replyTo ?? undefined,
    subject: input.subject,
    headers: unsubUrl
      ? { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
      : undefined,
  };
  if (input.messageId) mailOptions.messageId = input.messageId;
  if (input.attachmentsJson) {
    mailOptions.attachments = mailAttachments(input.attachmentsJson);
  }

  // Always send both text and HTML parts. Plain-text bodies get wrapped in basic HTML so
  // Gmail/Outlook render them as a coherent message rather than collapsing them behind "…".
  const htmlBody = isHtml ? bodyForSend : wrapPlainTextAsHtml(bodyForSend);
  const textBody = isHtml ? stripHtml(bodyForSend) : bodyForSend;
  const preview = (input.previewText ?? "").trim();
  mailOptions.html = injectHtmlFooter(injectPreheader(htmlBody, preview), pixelUrl, unsubUrl);
  mailOptions.text = buildTextFooter(textBody, unsubUrl);

  const info = await transport.sendMail(mailOptions);
  return { messageId: info.messageId };
}

function stripHtml(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+\n/g, "\n")
    .trim();
}

export async function verifyTransport(account: AccountWithSecret): Promise<void> {
  const transport = buildTransport(account);
  await transport.verify();
}

export type MergeValue = string | number | boolean | null | undefined | Record<string, unknown>;

const MERGE_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\s*\}\}/g;

function escapeMergeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function lookupMergeValue(vars: Record<string, MergeValue>, key: string): unknown {
  const parts = key.split(".");
  let value: unknown = vars;
  for (const part of parts) {
    if (!value || typeof value !== "object" || !(part in value)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

export function renderMergeFields(
  template: string,
  vars: Record<string, MergeValue>,
  options: { htmlEscape?: boolean } = {},
): string {
  return template.replace(MERGE_RE, (_match, key: string) => {
    const value = lookupMergeValue(vars, key);
    if (value === undefined || value === null || typeof value === "object") return "";
    const rendered = String(value);
    return options.htmlEscape ? escapeMergeHtml(rendered) : rendered;
  });
}

export function getPublicBaseUrl(): string {
  const explicit = process.env["PUBLIC_BASE_URL"];
  if (explicit) return explicit.replace(/\/$/, "");
  const domains = process.env["REPLIT_DOMAINS"];
  if (domains) {
    const first = domains.split(",")[0]?.trim();
    if (first) return `https://${first}`;
  }
  const dev = process.env["REPLIT_DEV_DOMAIN"];
  if (dev) return `https://${dev}`;
  return "http://localhost";
}

/** Classify a nodemailer error as a hard or soft bounce, if possible. */
export function classifyBounce(err: unknown): "hard" | "soft" | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { responseCode?: number; code?: string; response?: string };
  if (typeof e.responseCode === "number") {
    if (e.responseCode >= 500 && e.responseCode < 600) return "hard";
    if (e.responseCode >= 400 && e.responseCode < 500) return "soft";
  }
  const resp = (e.response ?? "").toLowerCase();
  if (/no such user|user unknown|does not exist|user not found|mailbox unavailable|invalid recipient/.test(resp)) return "hard";
  if (/over quota|mailbox full|temporarily|try again/.test(resp)) return "soft";
  return null;
}
