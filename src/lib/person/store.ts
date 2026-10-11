import type { RevealConfig } from "../config";
import { isMd5, isSha256, looksLikeEmail, md5Email, normaliseEmail, sha256Email } from "./hash";
import type { AuditEntry, PersonRecord, PersonState, SuppressionEntry } from "./types";

/** The state fields person-level code touches. The full State type lives in state.ts. */
export interface HasPerson {
  person?: PersonState;
}

const DAY = 86_400_000;
/** A queued address that was never looked up is deleted after this long. */
export const PENDING_MAX_MS = DAY;
/** Visits kept per person. */
export const MAX_PERSON_VISITS = 50;
/** Audit rows kept at most, oldest dropped first. */
export const MAX_AUDIT = 5000;

export function emptyPerson(): PersonState {
  return { pending: [], people: {}, known: {}, suppression: [], audit: [] };
}

/** Creates the person-level section on first use. Nothing calls this while the feature is off, except opt-out and suppression import. */
export function ensurePerson(state: HasPerson): PersonState {
  state.person ??= emptyPerson();
  return state.person;
}

/** Appends one audit row. */
export function addAudit(state: HasPerson, e: AuditEntry): void {
  const p = ensurePerson(state);
  p.audit.push(e);
  if (p.audit.length > MAX_AUDIT) p.audit.splice(0, p.audit.length - MAX_AUDIT);
}

/** What the suppression check looks at for one identity. */
export interface Identity {
  emailSha256?: string;
  emailMd5?: string;
  workEmail?: string;
  companyDomain?: string;
}

const domainOf = (email: string | undefined): string | undefined => (email && email.includes("@") ? email.split("@").pop()!.toLowerCase() : undefined);

/** true when any hash or domain of the identity is on the suppression list. */
export function isSuppressed(state: HasPerson, id: Identity): boolean {
  const list = state.person?.suppression ?? [];
  if (list.length === 0) return false;
  const sha = new Set([id.emailSha256, id.workEmail ? sha256Email(id.workEmail) : undefined].filter(Boolean));
  const md5 = new Set([id.emailMd5, id.workEmail ? md5Email(id.workEmail) : undefined].filter(Boolean));
  const domains = new Set([id.companyDomain?.toLowerCase(), domainOf(id.workEmail)].filter(Boolean));
  return list.some((e) => (e.kind === "sha256" && sha.has(e.value)) || (e.kind === "md5" && md5.has(e.value)) || (e.kind === "domain" && domains.has(e.value)));
}

function addEntry(p: PersonState, e: SuppressionEntry): boolean {
  if (p.suppression.some((x) => x.kind === e.kind && x.value === e.value)) return false;
  p.suppression.push(e);
  return true;
}

const cleanDomain = (s: string): string => s.trim().toLowerCase().replace(/^@/, "").replace(/^www\./, "");
const looksLikeDomain = (s: string): boolean => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s);

export interface DeleteResult {
  people: number;
  links: number;
  pending: number;
  audit: number;
}

/** Deletes everything stored for the hashes and domains. Audit rows keep their decision but lose the subject. */
function removeMatching(state: HasPerson, sha: Set<string>, md5: Set<string>, domains: Set<string>): DeleteResult {
  const p = state.person;
  const r: DeleteResult = { people: 0, links: 0, pending: 0, audit: 0 };
  if (!p) return r;
  const gone = new Set<string>();
  for (const [id, rec] of Object.entries(p.people)) {
    const hit =
      (rec.emailSha256 && sha.has(rec.emailSha256)) ||
      (rec.workEmailSha256 && sha.has(rec.workEmailSha256)) ||
      (rec.emailMd5 && md5.has(rec.emailMd5)) ||
      (rec.companyDomain && domains.has(rec.companyDomain)) ||
      (rec.workEmail && domains.has(domainOf(rec.workEmail) ?? ""));
    if (hit) {
      gone.add(id);
      delete p.people[id];
      r.people++;
    }
  }
  const goneVids = new Set<string>();
  for (const [vid, link] of Object.entries(p.known)) {
    if (sha.has(link.emailSha256)) {
      delete p.known[vid];
      goneVids.add(vid);
      r.links++;
    }
  }
  const before = p.pending.length;
  p.pending = p.pending.filter((x) => !(x.emailHash && sha.has(x.emailHash)) && !goneVids.has(x.vidKey));
  r.pending = before - p.pending.length;
  for (const a of p.audit) {
    if (a.subject && gone.has(a.subject)) {
      a.subject = undefined;
      r.audit++;
    }
  }
  return r;
}

/**
 * Adds addresses, hashes and domains to the suppression list and deletes stored data for them.
 * One entry per line or comma. An email becomes a SHA-256 and an MD5 entry; the address itself is not kept.
 */
export function importSuppression(state: HasPerson, input: string, now: Date, source: SuppressionEntry["source"] = "import"): { added: number; skipped: number; deleted: DeleteResult } {
  const p = ensurePerson(state);
  const at = now.toISOString();
  let added = 0;
  let skipped = 0;
  const sha = new Set<string>();
  const md5 = new Set<string>();
  const domains = new Set<string>();
  for (const raw of input.split(/[\n\r,;]+/)) {
    const t = raw.trim();
    if (!t) continue;
    const entries: SuppressionEntry[] = [];
    if (looksLikeEmail(t)) {
      entries.push({ kind: "sha256", value: sha256Email(t), addedAt: at, source }, { kind: "md5", value: md5Email(t), addedAt: at, source });
    } else if (isSha256(t)) entries.push({ kind: "sha256", value: t.toLowerCase(), addedAt: at, source });
    else if (isMd5(t)) entries.push({ kind: "md5", value: t.toLowerCase(), addedAt: at, source });
    else if (looksLikeDomain(cleanDomain(t))) entries.push({ kind: "domain", value: cleanDomain(t), addedAt: at, source });
    else {
      skipped++;
      continue;
    }
    for (const e of entries) {
      if (addEntry(p, e)) added++;
      (e.kind === "sha256" ? sha : e.kind === "md5" ? md5 : domains).add(e.value);
    }
  }
  const deleted = removeMatching(state, sha, md5, domains);
  if (added > 0 || skipped > 0) addAudit(state, { at, kind: "suppress_import", supplier: "-", outcome: "added", why: `${added} suppression entries added (${source}), ${deleted.people} stored people deleted`, costMicros: 0 });
  return { added, skipped, deleted };
}

/** Public opt-out. Adds the email's hashes to the suppression list and deletes what is stored for them. Works whether or not person-level is on. */
export function optOutEmail(state: HasPerson, email: string, now: Date): DeleteResult {
  const e = normaliseEmail(email);
  const p = ensurePerson(state);
  const at = now.toISOString();
  addEntry(p, { kind: "sha256", value: sha256Email(e), addedAt: at, source: "optout" });
  addEntry(p, { kind: "md5", value: md5Email(e), addedAt: at, source: "optout" });
  const r = removeMatching(state, new Set([sha256Email(e)]), new Set([md5Email(e)]), new Set());
  addAudit(state, { at, kind: "optout", supplier: "-", outcome: "suppressed", why: `Opt-out received. ${r.people} stored people and ${r.links} links deleted.`, costMicros: 0 });
  return r;
}

/** Delete-by-email. Removes stored data for the address. With suppress it also keeps the person from being looked up again. */
export function deleteByEmail(state: HasPerson, email: string, opts: { suppress: boolean }, now: Date): DeleteResult {
  if (opts.suppress) return optOutEmail(state, email, now);
  const e = normaliseEmail(email);
  const r = removeMatching(state, new Set([sha256Email(e)]), new Set([md5Email(e)]), new Set());
  addAudit(state, { at: now.toISOString(), kind: "delete", supplier: "-", outcome: "deleted", why: `Deleted by email. ${r.people} stored people and ${r.links} links removed.`, costMicros: 0 });
  return r;
}

/** Deletes people, links, queued addresses and audit rows past their windows. Runs whether or not the feature is on. */
export function purgePerson(state: HasPerson, config: RevealConfig, now: Date): { people: number; links: number; pending: number; audit: number } {
  const p = state.person;
  if (!p) return { people: 0, links: 0, pending: 0, audit: 0 };
  const cutoff = new Date(now.getTime() - config.personLevel.retentionDays * DAY).toISOString();
  const auditCutoff = new Date(now.getTime() - config.personLevel.auditRetentionDays * DAY).toISOString();
  const pendingCutoff = new Date(now.getTime() - PENDING_MAX_MS).toISOString();
  const r = { people: 0, links: 0, pending: 0, audit: 0 };
  const gone = new Set<string>();
  for (const [id, rec] of Object.entries(p.people)) {
    if (rec.lastSeen < cutoff) {
      delete p.people[id];
      gone.add(id);
      r.people++;
    } else rec.visits = rec.visits.filter((v) => v.ts >= cutoff);
  }
  for (const [vid, link] of Object.entries(p.known)) {
    if (link.at < cutoff) {
      delete p.known[vid];
      r.links++;
    }
  }
  const before = p.pending.length;
  p.pending = p.pending.filter((x) => x.ts >= pendingCutoff);
  r.pending = before - p.pending.length;
  for (const a of p.audit) if (a.subject && gone.has(a.subject)) a.subject = undefined;
  const auditBefore = p.audit.length;
  p.audit = p.audit.filter((a) => a.at >= auditCutoff);
  r.audit = auditBefore - p.audit.length;
  p.lastPurge = now.toISOString();
  return r;
}

export type { PersonRecord };
