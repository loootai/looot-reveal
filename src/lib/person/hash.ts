import { createHash } from "node:crypto";

/** Lower-cases and trims an email, the form every hash in this app is taken from. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** SHA-256 of the normalised email, as 64 hex characters. */
export function sha256Email(email: string): string {
  return createHash("sha256").update(normaliseEmail(email)).digest("hex");
}

/** MD5 of the normalised email, as 32 hex characters. Many identity suppliers still key on MD5. */
export function md5Email(email: string): string {
  return createHash("md5").update(normaliseEmail(email)).digest("hex");
}

/** true for 64 hex characters. */
export const isSha256 = (s: string): boolean => /^[a-f0-9]{64}$/i.test(s);

/** true for 32 hex characters. */
export const isMd5 = (s: string): boolean => /^[a-f0-9]{32}$/i.test(s);

/** true for something that looks like one email address. */
export const looksLikeEmail = (s: string): boolean => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(s.trim());

/** Short stable id from any string, used as a record key. */
export function shortId(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}
