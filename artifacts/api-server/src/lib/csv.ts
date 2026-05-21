export interface LeadRow {
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  title?: string;
  website?: string;
  phone?: string;
}

/**
 * Parse a single CSV line into fields. Honors:
 *  - Double-quoted fields that may contain commas and CRLF
 *  - Escaped quotes inside quoted fields ("")
 *  - Bare \r at end of line
 */
function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else if (ch === "\r") {
      // skip
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields.map((f) => f.trim());
}

/**
 * Split CSV text into logical rows. Newlines inside quoted fields are preserved as part of the field.
 */
function splitRows(text: string): string[] {
  const rows: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      cur += ch;
    } else if (ch === "\n" && !inQuotes) {
      if (cur.length > 0) rows.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) rows.push(cur);
  return rows;
}

const HEADER_ALIASES: Record<string, keyof LeadRow> = {
  email: "email",
  emailaddress: "email",
  firstname: "firstName",
  fname: "firstName",
  givenname: "firstName",
  lastname: "lastName",
  lname: "lastName",
  surname: "lastName",
  familyname: "lastName",
  company: "company",
  organization: "company",
  companyname: "company",
  title: "title",
  jobtitle: "title",
  position: "title",
  website: "website",
  url: "website",
  domain: "website",
  phone: "phone",
  phonenumber: "phone",
  mobile: "phone",
};

function normalizeHeader(h: string): keyof LeadRow | null {
  const k = h.toLowerCase().replace(/[^a-z]/g, "");
  return HEADER_ALIASES[k] ?? null;
}

export interface ParseCsvResult {
  leads: LeadRow[];
  error?: string;
}

/** Parse a CSV string into structured lead rows. Returns an error if there's no usable email column. */
export function parseLeadsCsv(text: string): ParseCsvResult {
  const rows = splitRows(text.trim());
  if (rows.length === 0) return { leads: [], error: "CSV is empty" };

  const headerRow = rows[0];
  if (!headerRow) return { leads: [], error: "CSV is empty" };

  const headers = parseCsvRow(headerRow).map(normalizeHeader);
  const emailIdx = headers.indexOf("email");
  if (emailIdx === -1) {
    return { leads: [], error: "CSV must have an 'email' column" };
  }

  const leads: LeadRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const rowText = rows[i];
    if (!rowText || rowText.trim() === "") continue;
    const cols = parseCsvRow(rowText);
    const email = cols[emailIdx];
    if (!email || !email.includes("@")) continue;

    const lead: LeadRow = { email };
    for (let h = 0; h < headers.length; h++) {
      const key = headers[h];
      if (!key || key === "email") continue;
      const val = cols[h];
      if (val) lead[key] = val;
    }
    leads.push(lead);
  }
  return { leads };
}
