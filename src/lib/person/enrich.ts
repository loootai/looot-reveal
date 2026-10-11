import type { LoootRun } from "../looot";
import { toMicros } from "../money";
import { isSha256 } from "./hash";
import type { EnrichConfig } from "./schema";
import type { PersonCandidate } from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

/** Job id the enrichment calls are recorded under in the call log. */
export const PERSON_ENRICH_JOB = "person.enrich";

/** Idempotency key for one enrichment call. The same hash always maps to the same key, so a retry never pays twice. */
export const enrichKey = (endpointId: string, emailHash: string): string => `reveal:person.enrich:${endpointId}:${emailHash}`;

/**
 * The looot input for People Data Labs person enrich. It sends the hash, never an email, and asks only for a
 * match PDL scores at or above min_likelihood.
 */
export function enrichInput(emailHash: string, cfg: EnrichConfig): Record<string, unknown> {
  return { email_hash: emailHash, min_likelihood: cfg.minLikelihood, titlecase: true, pretty: false };
}

/** Reads a People Data Labs person body: { status, likelihood, data: { full_name, job_title, ... } }. null when there is no match. */
export function parsePdlPerson(body: unknown): Omit<PersonCandidate, "supplier" | "costMicros"> | null {
  if (!isObj(body)) return null;
  if (typeof body.status === "number" && body.status !== 200) return null;
  const d = isObj(body.data) ? body.data : body;
  const name = str(d.full_name) ?? ([str(d.first_name), str(d.last_name)].filter(Boolean).join(" ") || undefined);
  const linkedinUrl = str(d.linkedin_url);
  if (!name && !linkedinUrl) return null;
  const like = typeof body.likelihood === "number" ? body.likelihood : undefined;
  const site = str(d.job_company_website);
  return {
    name,
    title: str(d.job_title),
    company: str(d.job_company_name),
    companyDomain: site?.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""),
    linkedinUrl,
    workEmail: str(d.work_email),
    confidence: like === undefined ? undefined : Math.min(1, Math.max(0, like / 10)),
  };
}

/** Pulls a candidate out of a finished looot run. */
export function candidateFromRun(run: LoootRun): { candidate: Omit<PersonCandidate, "supplier" | "costMicros"> | null; costMicros: number } {
  const costMicros = toMicros(run.actualCost);
  if (run.status !== "completed") return { candidate: null, costMicros };
  return { candidate: parsePdlPerson(run.result), costMicros };
}

export const canEnrichWith = (hash: string | undefined): hash is string => Boolean(hash && isSha256(hash));
