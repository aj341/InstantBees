import nodemailer, { type Transporter } from "nodemailer";
import type { EmailAccount } from "@workspace/db";
import { decryptSecret } from "./crypto";

export type AccountWithSecret = Pick<
  EmailAccount,
  "email" | "name" | "provider" | "smtpHost" | "smtpPort" | "smtpUsername" | "smtpPasswordEnc"
>;

const GMAIL = { host: "smtp.gmail.com", port: 587 };
const OUTLOOK = { host: "smtp.office365.com", port: 587 };

export function resolveSmtp(account: AccountWithSecret): { host: string; port: number; username: string; password: string } {
  if (!account.smtpPasswordEnc) {
    throw new Error("No SMTP password configured for this account");
  }
  let host = account.smtpHost;
  let port = account.smtpPort;
  if (!host || !port) {
    if (account.provider === "gmail") {
      host = host ?? GMAIL.host;
      port = port ?? GMAIL.port;
    } else if (account.provider === "outlook") {
      host = host ?? OUTLOOK.host;
      port = port ?? OUTLOOK.port;
    } else {
      throw new Error("SMTP host/port not configured");
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
  subject: string;
  body: string;
  bodyType: "text" | "html" | string;
}

export async function sendEmail(account: AccountWithSecret, input: SendInput): Promise<{ messageId: string }> {
  const transport = buildTransport(account);
  const fromHeader = account.name ? `"${account.name}" <${account.email}>` : account.email;
  const toHeader = input.toName ? `"${input.toName}" <${input.to}>` : input.to;
  const info = await transport.sendMail({
    from: fromHeader,
    to: toHeader,
    subject: input.subject,
    ...(input.bodyType === "html" ? { html: input.body } : { text: input.body }),
  });
  return { messageId: info.messageId };
}

export async function verifyTransport(account: AccountWithSecret): Promise<void> {
  const transport = buildTransport(account);
  await transport.verify();
}

const MERGE_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export function renderMergeFields(template: string, vars: Record<string, string | null | undefined>): string {
  return template.replace(MERGE_RE, (_match, key: string) => {
    const v = vars[key];
    return v == null ? "" : String(v);
  });
}
