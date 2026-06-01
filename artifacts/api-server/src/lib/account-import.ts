import { inArray } from "drizzle-orm";
import { db, emailAccountsTable, type EmailAccount } from "@workspace/db";
import { encryptSecret } from "./crypto";
import { rebalancePendingJobsForActiveCampaigns } from "./account-rotation";

type Provider = EmailAccount["provider"];

export type AccountImportRow = {
  email?: unknown;
  name?: unknown;
  provider?: unknown;
  warmupEnabled?: unknown;
  dailySendLimit?: unknown;
  smtpHost?: unknown;
  smtpPort?: unknown;
  smtpUsername?: unknown;
  smtpPassword?: unknown;
  imapHost?: unknown;
  imapPort?: unknown;
};

export type AccountBulkImportInput = {
  accounts?: AccountImportRow[];
  csvText?: string;
  defaultProvider?: Provider;
};

export type AccountBulkImportError = {
  row: number;
  email?: string;
  reason: string;
};

export type AccountBulkImportResult = {
  total: number;
  imported: number;
  skipped: number;
  accountIds: number[];
  errors: AccountBulkImportError[];
};

const PROVIDERS = new Set<Provider>(["gmail", "outlook", "smtp"]);

const SMTP_DEFAULTS: Record<Provider, { host: string | null; port: number }> = {
  gmail: { host: "smtp.gmail.com", port: 587 },
  outlook: { host: "smtp.office365.com", port: 587 },
  smtp: { host: null, port: 587 },
};

const IMAP_DEFAULTS: Record<Provider, { host: string | null; port: number }> = {
  gmail: { host: "imap.gmail.com", port: 993 },
  outlook: { host: "outlook.office365.com", port: 993 },
  smtp: { host: null, port: 993 },
};

const HEADER_ALIASES: Record<string, keyof AccountImportRow> = {
  email: "email",
  emailaddress: "email",
  address: "email",
  mailbox: "email",
  account: "email",
  login: "email",
  name: "name",
  displayname: "name",
  fromname: "name",
  sendername: "name",
  provider: "provider",
  type: "provider",
  warmup: "warmupEnabled",
  warmupenabled: "warmupEnabled",
  enablewarmup: "warmupEnabled",
  daily: "dailySendLimit",
  dailylimit: "dailySendLimit",
  dailysendlimit: "dailySendLimit",
  sendlimit: "dailySendLimit",
  limit: "dailySendLimit",
  smtphost: "smtpHost",
  smtpserver: "smtpHost",
  host: "smtpHost",
  smtpport: "smtpPort",
  port: "smtpPort",
  smtpusername: "smtpUsername",
  smtpuser: "smtpUsername",
  username: "smtpUsername",
  user: "smtpUsername",
  smtppassword: "smtpPassword",
  password: "smtpPassword",
  apppassword: "smtpPassword",
  imaphost: "imapHost",
  imapserver: "imapHost",
  imapport: "imapPort",
};

function keyForHeader(header: string): keyof AccountImportRow | null {
  const cleaned = header.toLowerCase().replace(/[^a-z0-9]/g, "");
  return HEADER_ALIASES[cleaned] ?? null;
}

function cleanString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function parseBoolean(value: unknown): boolean {
  const text = cleanString(value)?.toLowerCase();
  return text === "true" || text === "yes" || text === "y" || text === "1" || text === "on";
}

function parsePositiveInt(value: unknown, fallback: number, max = 10000): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function parseProvider(value: unknown, fallback: Provider): Provider {
  const provider = cleanString(value)?.toLowerCase();
  return provider && PROVIDERS.has(provider as Provider) ? (provider as Provider) : fallback;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }

  cells.push(cell.trim());
  return cells;
}

export function parseAccountsCsv(csvText: string): AccountImportRow[] {
  const lines = csvText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]!).map(keyForHeader);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row: AccountImportRow = {};
    headers.forEach((key, index) => {
      if (key) row[key] = cells[index] ?? "";
    });
    return row;
  });
}

function normalizeRow(row: AccountImportRow, defaultProvider: Provider): { values?: Record<string, unknown>; email?: string; reason?: string } {
  const email = cleanString(row.email)?.toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { email, reason: "Valid email is required" };
  }

  const provider = parseProvider(row.provider, defaultProvider);
  const warmupEnabled = parseBoolean(row.warmupEnabled);
  const smtpDefaults = SMTP_DEFAULTS[provider];
  const imapDefaults = IMAP_DEFAULTS[provider];
  const smtpPassword = cleanString(row.smtpPassword);
  const smtpHost = cleanString(row.smtpHost) ?? smtpDefaults.host;
  const imapHost = cleanString(row.imapHost) ?? imapDefaults.host;

  const values: Record<string, unknown> = {
    email,
    name: cleanString(row.name),
    provider,
    status: warmupEnabled ? "warming" : "connected",
    warmupEnabled,
    dailySendLimit: parsePositiveInt(row.dailySendLimit, 50),
    smtpHost,
    smtpPort: parsePositiveInt(row.smtpPort, smtpDefaults.port, 65535),
    smtpUsername: cleanString(row.smtpUsername),
    imapHost,
    imapPort: parsePositiveInt(row.imapPort, imapDefaults.port, 65535),
  };

  if (smtpPassword) {
    values.smtpPasswordEnc = encryptSecret(smtpPassword);
  }

  return { email, values };
}

export async function importEmailAccounts(input: AccountBulkImportInput): Promise<AccountBulkImportResult> {
  const defaultProvider = parseProvider(input.defaultProvider, "gmail");
  const rows = [
    ...(Array.isArray(input.accounts) ? input.accounts : []),
    ...(typeof input.csvText === "string" ? parseAccountsCsv(input.csvText) : []),
  ];

  const result: AccountBulkImportResult = {
    total: rows.length,
    imported: 0,
    skipped: 0,
    accountIds: [],
    errors: [],
  };

  if (rows.length === 0) return result;

  const normalizedRows = rows.map((row, index) => ({
    rowNumber: index + 2,
    ...normalizeRow(row, defaultProvider),
  }));
  const emails = normalizedRows
    .map((row) => row.email)
    .filter((email): email is string => !!email);
  const existingRows = emails.length
    ? await db
        .select({ email: emailAccountsTable.email })
        .from(emailAccountsTable)
        .where(inArray(emailAccountsTable.email, emails))
    : [];
  const existingEmails = new Set(existingRows.map((row) => row.email.toLowerCase()));
  const seenEmails = new Set<string>();
  let shouldRebalance = false;

  for (const row of normalizedRows) {
    if (row.reason || !row.email || !row.values) {
      result.skipped += 1;
      result.errors.push({ row: row.rowNumber, email: row.email, reason: row.reason ?? "Invalid row" });
      continue;
    }
    if (seenEmails.has(row.email)) {
      result.skipped += 1;
      result.errors.push({ row: row.rowNumber, email: row.email, reason: "Duplicate in import file" });
      continue;
    }
    seenEmails.add(row.email);
    if (existingEmails.has(row.email)) {
      result.skipped += 1;
      result.errors.push({ row: row.rowNumber, email: row.email, reason: "Account already exists" });
      continue;
    }

    const [account] = await db.insert(emailAccountsTable).values(row.values as any).returning();
    if (!account) {
      result.skipped += 1;
      result.errors.push({ row: row.rowNumber, email: row.email, reason: "Insert failed" });
      continue;
    }

    existingEmails.add(row.email);
    result.imported += 1;
    result.accountIds.push(account.id);
    if ((account.status === "connected" || account.status === "warming") && account.smtpPasswordEnc) {
      shouldRebalance = true;
    }
  }

  if (shouldRebalance) {
    await rebalancePendingJobsForActiveCampaigns();
  }

  return result;
}
