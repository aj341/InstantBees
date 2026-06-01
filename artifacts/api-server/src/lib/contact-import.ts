import { eq } from "drizzle-orm";
import { db, leadsTable, listLeadsTable, type Lead } from "@workspace/db";

export type DuplicateMode = "skip" | "update" | "error";

export type ContactInput = {
  email?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  company?: unknown;
  title?: unknown;
  roleTitle?: unknown;
  role_title?: unknown;
  website?: unknown;
  phone?: unknown;
  linkedinUrl?: unknown;
  customFields?: unknown;
  [key: string]: unknown;
};

export type ContactImportResult = {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  leadIds: number[];
  createdIds: number[];
  updatedIds: number[];
  skippedContacts: Array<{ row: number; email: string; reason: string; leadId?: number }>;
  failures: Array<{ row: number; email?: string; reason: string }>;
};

const STANDARD_KEYS = new Set([
  "email",
  "firstname",
  "first_name",
  "first",
  "lastname",
  "last_name",
  "last",
  "company",
  "companyname",
  "account",
  "title",
  "jobtitle",
  "role",
  "roletitle",
  "role_title",
  "jobrole",
  "job_role",
  "website",
  "domain",
  "url",
  "phone",
  "phonenumber",
  "mobile",
  "linkedinurl",
  "linkedin_url",
  "linkedin",
  "linkedinprofile",
  "customfields",
]);

function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const valueText = String(value).trim();
  return valueText.length > 0 ? valueText : null;
}

function headerKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

export function parseCsvLine(line: string): string[] {
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

function cleanCustomFields(value: unknown): Record<string, string | number | boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const fields: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(value)) {
    const cleanKey = key.trim();
    if (!cleanKey) continue;
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      fields[cleanKey] = raw;
    } else if (raw !== undefined && raw !== null) {
      fields[cleanKey] = String(raw);
    }
  }
  return fields;
}

function customFieldsJson(value: unknown): string | null {
  const fields = cleanCustomFields(value);
  return Object.keys(fields).length > 0 ? JSON.stringify(fields) : null;
}

function mergeCustomFields(existingJson: string | null | undefined, incoming: unknown): string | null {
  const existing = (() => {
    if (!existingJson) return {};
    try {
      return cleanCustomFields(JSON.parse(existingJson));
    } catch {
      return {};
    }
  })();
  const merged = { ...existing, ...cleanCustomFields(incoming) };
  return Object.keys(merged).length > 0 ? JSON.stringify(merged) : null;
}

export function contactsFromCsv(csvText: string): ContactInput[] {
  const lines = csvText.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const rawHeaders = parseCsvLine(lines[0]!);
  const headers = rawHeaders.map(headerKey);
  const index = (names: string[]) => headers.findIndex((header) => names.includes(header));
  const columns = {
    email: index(["email", "emailaddress"]),
    firstName: index(["firstname", "first_name", "first"]),
    lastName: index(["lastname", "last_name", "last"]),
    company: index(["company", "companyname", "account"]),
    title: index(["title", "jobtitle", "role"]),
    roleTitle: index(["roletitle", "role_title", "jobrole", "job_role"]),
    website: index(["website", "domain", "url"]),
    phone: index(["phone", "phonenumber", "mobile"]),
    linkedinUrl: index(["linkedinurl", "linkedin_url", "linkedin", "linkedinprofile"]),
  };
  if (columns.email < 0) return [];

  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const customFields: Record<string, string> = {};
    rawHeaders.forEach((header, i) => {
      const key = headerKey(header);
      const value = cells[i]?.trim();
      if (!value || STANDARD_KEYS.has(key)) return;
      customFields[header.trim()] = value;
    });
    return {
      email: cells[columns.email],
      firstName: columns.firstName >= 0 ? cells[columns.firstName] : undefined,
      lastName: columns.lastName >= 0 ? cells[columns.lastName] : undefined,
      company: columns.company >= 0 ? cells[columns.company] : undefined,
      title: columns.title >= 0 ? cells[columns.title] : undefined,
      roleTitle: columns.roleTitle >= 0 ? cells[columns.roleTitle] : undefined,
      website: columns.website >= 0 ? cells[columns.website] : undefined,
      phone: columns.phone >= 0 ? cells[columns.phone] : undefined,
      linkedinUrl: columns.linkedinUrl >= 0 ? cells[columns.linkedinUrl] : undefined,
      customFields,
    };
  });
}

export async function importContacts(input: {
  contacts?: ContactInput[];
  csvText?: string;
  listId?: number | null;
  onDuplicate?: DuplicateMode;
}): Promise<ContactImportResult> {
  const contacts = [
    ...(Array.isArray(input.contacts) ? input.contacts : []),
    ...(typeof input.csvText === "string" ? contactsFromCsv(input.csvText) : []),
  ];
  const mode = input.onDuplicate ?? "skip";
  const result: ContactImportResult = {
    total: contacts.length,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    leadIds: [],
    createdIds: [],
    updatedIds: [],
    skippedContacts: [],
    failures: [],
  };

  for (let i = 0; i < contacts.length; i += 1) {
    const contact = contacts[i]!;
    const email = text(contact.email)?.toLowerCase();
    if (!email || !email.includes("@")) {
      result.failed += 1;
      result.failures.push({ row: i + 1, email: email ?? undefined, reason: "Valid email is required" });
      continue;
    }

    const values = {
      email,
      firstName: text(contact.firstName),
      lastName: text(contact.lastName),
      company: text(contact.company),
      title: text(contact.title),
      roleTitle: text(contact.roleTitle ?? contact.role_title),
      website: text(contact.website),
      phone: text(contact.phone),
      linkedinUrl: text(contact.linkedinUrl),
      customFieldsJson: customFieldsJson(contact.customFields),
    };

    const [existing] = await db.select().from(leadsTable).where(eq(leadsTable.email, email));
    if (existing) {
      if (mode === "error") {
        result.failed += 1;
        result.failures.push({ row: i + 1, email, reason: "Duplicate email" });
        continue;
      }
      result.leadIds.push(existing.id);
      if (input.listId) await db.insert(listLeadsTable).values({ listId: input.listId, leadId: existing.id }).onConflictDoNothing();
      if (mode === "skip") {
        result.skipped += 1;
        result.skippedContacts.push({ row: i + 1, email, reason: "Duplicate email", leadId: existing.id });
        continue;
      }
      const [updated] = await db.update(leadsTable).set({
        firstName: values.firstName ?? existing.firstName,
        lastName: values.lastName ?? existing.lastName,
        company: values.company ?? existing.company,
        title: values.title ?? existing.title,
        roleTitle: values.roleTitle ?? existing.roleTitle,
        website: values.website ?? existing.website,
        phone: values.phone ?? existing.phone,
        linkedinUrl: values.linkedinUrl ?? existing.linkedinUrl,
        customFieldsJson: mergeCustomFields(existing.customFieldsJson, contact.customFields),
      }).where(eq(leadsTable.id, existing.id)).returning();
      result.updated += 1;
      result.updatedIds.push(updated?.id ?? existing.id);
      continue;
    }

    const [created] = await db.insert(leadsTable).values(values).returning();
    if (!created) {
      result.failed += 1;
      result.failures.push({ row: i + 1, email, reason: "Failed to create contact" });
      continue;
    }
    result.created += 1;
    result.createdIds.push(created.id);
    result.leadIds.push(created.id);
    if (input.listId) await db.insert(listLeadsTable).values({ listId: input.listId, leadId: created.id }).onConflictDoNothing();
  }

  return result;
}

export function customFieldsForLead(lead: Pick<Lead, "customFieldsJson">): Record<string, string | number | boolean> {
  if (!lead.customFieldsJson) return {};
  try {
    return cleanCustomFields(JSON.parse(lead.customFieldsJson));
  } catch {
    return {};
  }
}
