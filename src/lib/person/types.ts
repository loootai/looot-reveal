/** What a supplier needs to look a visitor up. The email hash is set only when the site itself already holds the email. */
export interface PersonLookupInput {
  ip: string;
  userAgent: string;
  /** First-party visitor id from the snippet. */
  visitorId: string;
  pageUrl: string;
  timestamp: string;
  /** SHA-256 of an email the site already knows (login, form submit, hashed id in a campaign link). */
  emailHash?: string;
}

/** One possible identity for a visitor. Every field except `supplier` and `costMicros` is optional. */
export interface PersonCandidate {
  emailSha256?: string;
  emailMd5?: string;
  name?: string;
  workEmail?: string;
  linkedinUrl?: string;
  title?: string;
  company?: string;
  companyDomain?: string;
  /** 0 to 1. */
  confidence?: number;
  supplier: string;
  costMicros: number;
}

export interface AdapterContext {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
}

export interface AdapterResult {
  candidates: PersonCandidate[];
  /** Set when the call did not complete: missing_key, http_<status>, bad_json, request_failed. */
  failed?: string;
}

/** The slot. A supplier is anything that turns a PersonLookupInput into zero or more candidates. */
export interface PersonAdapter {
  id: string;
  label: string;
  /** List price of one call, in micro-dollars. Reserved against the spend cap before the call. */
  priceMicros: number;
  lookup(input: PersonLookupInput, ctx: AdapterContext): Promise<AdapterResult>;
}

/** A visit waiting for a person-level run. Holds the raw address until the attempt, then is deleted. */
export interface PendingLookup {
  id: string;
  /** Salted hash of the address, the same key the company side uses. */
  ipKey: string;
  ip: string;
  userAgent: string;
  visitorId: string;
  /** Salted hash of the visitor id. Used for storage; the raw id is deleted with the address. */
  vidKey: string;
  pageUrl: string;
  path: string;
  ts: string;
  emailHash?: string;
  country?: string;
}

export interface PersonRecord {
  id: string;
  emailSha256?: string;
  emailMd5?: string;
  /** Hash of the supplier's work email, kept even when the address itself is not. */
  workEmailSha256?: string;
  workEmail?: string;
  name?: string;
  linkedinUrl?: string;
  title?: string;
  company?: string;
  companyDomain?: string;
  confidence?: number;
  /** Where the identity came from, for example "known-visitor" or "acme-ids+people-data-labs-person-enrich". */
  supplier: string;
  costMicros: number;
  firstSeen: string;
  lastSeen: string;
  vidKeys: string[];
  ipKeys: string[];
  visits: { path: string; ts: string }[];
}

export type AuditKind = "lookup" | "skipped" | "optout" | "delete" | "suppress_import";

/** One line of the audit log. It holds no name, email, address or visitor id. */
export interface AuditEntry {
  at: string;
  kind: AuditKind;
  supplier: string;
  /** identified, no_match, failed, suppressed, cap_reached, or a skip reason such as gpc or blocked_region. */
  outcome: string;
  /** Why the attempt was allowed, or why it was refused. */
  why: string;
  /** Salted hash of the address or the person id. Cleared when the person is deleted. */
  subject?: string;
  costMicros: number;
  country?: string;
}

export interface SuppressionEntry {
  kind: "sha256" | "md5" | "domain";
  value: string;
  addedAt: string;
  source: "optout" | "import" | "manual";
}

export interface PersonState {
  pending: PendingLookup[];
  people: Record<string, PersonRecord>;
  /** First-party id (hashed) to the email hash the site gave for it. */
  known: Record<string, { emailSha256: string; at: string }>;
  suppression: SuppressionEntry[];
  audit: AuditEntry[];
  lastPurge?: string;
}
