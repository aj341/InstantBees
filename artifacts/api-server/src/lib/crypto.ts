import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const SECRET = process.env["SESSION_SECRET"];
if (!SECRET) {
  throw new Error("SESSION_SECRET is required to encrypt SMTP credentials");
}

const KEY = scryptSync(SECRET, "outreach-smtp-salt", 32);

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, encB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !encB64) throw new Error("Malformed encrypted payload");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const enc = Buffer.from(encB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}
