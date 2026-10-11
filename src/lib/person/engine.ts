import { createHash } from "node:crypto";
import type { RevealConfig } from "../config";
import type { LoootRunner } from "../looot";
import { toMicros } from "../money";
import { parseIpInfo } from "../parse";
import { ipKeyOf, type State } from "../state";
import { Budget } from "../waterfall";
import { canEnrichWith, candidateFromRun, enrichInput, enrichKey, PERSON_ENRICH_JOB } from "./enrich";
import { isPersonLevelActive, regionVerdict, signalVerdict } from "./gates";
import { isSha256, sha256Email, shortId } from "./hash";
import { createHttpAdapter } from "./httpAdapter";
import { addAudit, ensurePerson, isSuppressed, MAX_PERSON_VISITS, purgePerson } from "./store";
import type { PendingLookup, PersonCandidate, PersonRecord } from "./types";

export { deleteByEmail, importSuppression, optOutEmail, purgePerson } from "./store";

/** Job id the supplier calls are recorded under in the call log. */
export const PERSON_IDENTIFY_JOB = "person.identify";

/** What the collect route knows about one page view. The address is raw here and is deleted after the lookup attempt. */
export interface VisitSignals {
  ip: string;
  userAgent: string;
  path: string;
  /** Origin of the page, so the supplier can be sent a full URL. */
  origin?: string;
  /** First-party visitor id from the snippet. */
  visitorId?: string;
  /** SHA-256 of an email the site already holds for this visitor. */
  emailHash?: string;
  gpc: boolean;
  dnt: boolean;
  personConsent: boolean;
  /** Two-letter country from a CDN header, when there is one. */
  country?: string;
}

const REASON_TEXT: Record<string, string> = {
  gpc: "The browser sent Global Privacy Control.",
  dnt: "The browser sent Do Not Track.",
  no_consent: "No consent signal from the consent banner.",
  blocked_region: "The address is in the EU, EEA, UK or Switzerland, which are always blocked.",
  region_not_allowed: "The country is not on the allow-list.",
  region_unknown: "The country could not be found, so the lookup was refused.",
  suppressed: "The email hash or domain is on the suppression list.",
};

const COUNTRY_RE = /^[A-Za-z]{2}$/;

/**
 * Takes one page view into the person-level queue, after the checks that need no lookup: switch, GPC and DNT,
 * consent, a country the CDN already gave, and the suppression list. A refused view is recorded in the audit log
 * without its address. Does nothing and stores nothing while person-level is off.
 */
export function queuePersonVisit(state: State, config: RevealConfig, s: VisitSignals, now: Date): { queued: boolean; reason: string } {
  if (!isPersonLevelActive(config)) return { queued: false, reason: "disabled" };
  const at = now.toISOString();
  const p = ensurePerson(state);
  const country = s.country && COUNTRY_RE.test(s.country) ? s.country.toUpperCase() : undefined;
  const refuse = (reason: string) => {
    addAudit(state, { at, kind: "skipped", supplier: "-", outcome: reason, why: REASON_TEXT[reason] ?? reason, costMicros: 0, ...(country ? { country } : {}) });
    return { queued: false, reason };
  };
  const sv = signalVerdict(s, config);
  if (!sv.ok) return refuse(sv.reason);
  if (country) {
    const rv = regionVerdict(country, config);
    if (!rv.allowed) return refuse(rv.reason);
  }
  const emailHash = config.personLevel.knownVisitor.enabled && s.emailHash && isSha256(s.emailHash) ? s.emailHash.toLowerCase() : undefined;
  if (emailHash && isSuppressed(state, { emailSha256: emailHash })) return refuse("suppressed");
  const ipKey = ipKeyOf(s.ip, state, config);
  const vidKey = s.visitorId ? shortId(`${state.salt}:vid:${s.visitorId}`) : "";
  const path = s.path.split("?")[0].split("#")[0] || "/";
  const pending: PendingLookup = {
    id: shortId(`${ipKey}:${vidKey}:${at}:${path}:${p.pending.length}`),
    ipKey,
    ip: s.ip,
    userAgent: s.userAgent,
    visitorId: s.visitorId ?? "",
    vidKey,
    pageUrl: s.origin ? `${s.origin.replace(/\/+$/, "")}${path}` : path,
    path,
    ts: at,
    ...(emailHash ? { emailHash } : {}),
    ...(country ? { country } : {}),
  };
  p.pending.push(pending);
  return { queued: true, reason: "queued" };
}

export interface PersonQuoteLine {
  label: string;
  calls: number;
  priceMicros: number;
}

export interface PersonQuote {
  /** Queued visitors, one per first-party id (or per address when there is no id). */
  pending: number;
  lines: PersonQuoteLine[];
  maxMicros: number;
  capMicros: number;
  capBinds: boolean;
}

/** Groups queued visits so each visitor is looked up once. */
function groupPending(state: State): Map<string, PendingLookup[]> {
  const m = new Map<string, PendingLookup[]>();
  for (const x of state.person?.pending ?? []) {
    const k = x.vidKey || x.ipKey;
    m.set(k, [...(m.get(k) ?? []), x]);
  }
  return m;
}

const enrichLabel = (endpointId: string): string => (endpointId.includes("people-data-labs") ? "People Data Labs person enrich via looot (email hash to person)" : `looot ${endpointId} (email hash to person)`);

/** Prices a person-level run before it happens: the most it can cost, with the cap. Free: makes no call. */
export function quotePersonRun(state: State, config: RevealConfig, capMicros: number): PersonQuote {
  const pl = config.personLevel;
  const groups = groupPending(state);
  let needSupplier = 0;
  let needEnrich = 0;
  for (const items of groups.values()) {
    const vid = items[0].vidKey;
    if (vid && Object.values(state.person?.people ?? {}).some((r) => r.vidKeys.includes(vid))) continue;
    const known = items.some((i) => i.emailHash) || Boolean(vid && state.person?.known[vid]);
    if (!known && pl.http.enabled) needSupplier++;
    if (pl.enrich.enabled) needEnrich++;
  }
  const lines: PersonQuoteLine[] = [];
  if (pl.http.enabled) lines.push({ label: `${pl.http.label} (your supplier contract)`, calls: needSupplier, priceMicros: Math.round(pl.http.priceUsd * 1_000_000) });
  if (pl.enrich.enabled) lines.push({ label: enrichLabel(pl.enrich.endpointId), calls: needEnrich, priceMicros: Math.round(pl.enrich.priceUsd * 1_000_000) });
  const maxMicros = lines.reduce((n, l) => n + l.calls * l.priceMicros, 0);
  return { pending: groups.size, lines, maxMicros, capMicros, capBinds: maxMicros > capMicros };
}

export interface PersonRunDeps {
  looot: LoootRunner | null;
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  now: Date;
  capMicros: number;
}

export interface PersonRunResult {
  spentMicros: number;
  identified: number;
  skipped: number;
  noMatch: number;
  failed: number;
  /** Visitors left queued because the next paid call would pass the cap. */
  notRun: number;
}

const hashKey = (k: string): string => createHash("sha256").update(k).digest("hex").slice(0, 12);

function whyAllowed(config: RevealConfig, country: string, how: string): string {
  const pl = config.personLevel;
  return `${country} address on the allow-list (${pl.allowedRegions.join(", ")}), country from ${how}. No Global Privacy Control or Do Not Track. Consent signal ${pl.requireConsent ? "granted" : "not required"}. Not on the suppression list. Terms acknowledged ${pl.acknowledgedTerms}.`;
}

/**
 * Runs the queued visitors through the person-level checks and the supplier slot. For each visitor:
 * country gate, then the site's own email hash (free), else the HTTP supplier, then the looot enrichment
 * step when only a hash is known. Every paid call is reserved against the cap first. Every attempt is audited.
 * The raw address is deleted once the attempt is final.
 */
export async function runPersonLookups(state: State, config: RevealConfig, deps: PersonRunDeps): Promise<PersonRunResult> {
  const result: PersonRunResult = { spentMicros: 0, identified: 0, skipped: 0, noMatch: 0, failed: 0, notRun: 0 };
  if (!isPersonLevelActive(config) || !state.person) return result;
  const p = state.person;
  const pl = config.personLevel;
  const at = deps.now.toISOString();
  const budget = new Budget(deps.capMicros);
  const adapter = pl.http.enabled ? createHttpAdapter(pl.http) : null;
  const done = new Set<string>();
  const removeGroup = (items: PendingLookup[]) => items.forEach((i) => done.add(i.id));
  const addCall = (job: string, providerId: string, key: string, costMicros: number, status: string) => state.calls.push({ job, providerId, key: hashKey(key), costMicros, status, at });

  for (const items of groupPending(state).values()) {
    const lead = items[0];
    const vidKey = lead.vidKey;
    const ipKeys = [...new Set(items.map((i) => i.ipKey))];
    const visits = items.map((i) => ({ path: i.path, ts: i.ts }));

    // 1. Country gate. A CDN header wins, then a stored company answer, then the free IPinfo Lite call.
    let country = items.find((i) => i.country)?.country ?? state.resolutions[lead.ipKey]?.info?.country;
    let how = items.find((i) => i.country) ? "a CDN header" : "the stored company lookup";
    if (!country && deps.looot) {
      try {
        const run = await deps.looot.runAndWait("ipinfo-lite", { ip: lead.ip }, `reveal:person.geo:${lead.ipKey}`, { fallback: false });
        const cost = toMicros(run.actualCost);
        budget.settle(0, cost);
        addCall("person.geo", "ipinfo-lite", `geo:${lead.ipKey}`, cost, run.status);
        if (run.status === "completed") country = parseIpInfo(lead.ip, run.result).country;
        how = "IPinfo Lite";
      } catch {
        country = undefined;
      }
    }
    const rv = regionVerdict(country, config);
    if (!rv.allowed) {
      addAudit(state, { at, kind: "skipped", supplier: "-", outcome: rv.reason, why: REASON_TEXT[rv.reason], subject: lead.ipKey, costMicros: 0, ...(country ? { country: country.toUpperCase() } : {}) });
      result.skipped++;
      removeGroup(items);
      continue;
    }
    const cc = country!.toUpperCase();
    const why = whyAllowed(config, cc, how);

    // 2. A visitor already identified by the same first-party id: attach the visits, no lookup.
    const existing = vidKey ? Object.values(p.people).find((r) => r.vidKeys.includes(vidKey)) : undefined;
    if (existing) {
      attachVisits(existing, visits, ipKeys);
      addAudit(state, { at, kind: "lookup", supplier: "known-visitor", outcome: "linked", why: `${why} Linked to an earlier identification by the same first-party id.`, subject: existing.id, costMicros: 0, country: cc });
      result.identified++;
      removeGroup(items);
      continue;
    }

    // 3. The site's own email hash, free.
    const given = items.find((i) => i.emailHash)?.emailHash ?? (vidKey ? p.known[vidKey]?.emailSha256 : undefined);
    if (given && vidKey) p.known[vidKey] = { emailSha256: given, at };
    let best: PersonCandidate | null = given ? { emailSha256: given, supplier: "known-visitor", confidence: 1, costMicros: 0 } : null;
    let groupCost = 0;
    let supplierLabel = given ? "known-visitor" : adapter?.label ?? "-";

    // 4. The supplier slot.
    if (!best && adapter) {
      if (!budget.reserve(adapter.priceMicros)) {
        addAudit(state, { at, kind: "lookup", supplier: adapter.label, outcome: "cap_reached", why: "The next supplier call would pass the spend cap. The visitor stays queued.", subject: lead.ipKey, costMicros: 0, country: cc });
        result.notRun++;
        continue;
      }
      const out = await adapter.lookup({ ip: lead.ip, userAgent: lead.userAgent, visitorId: lead.visitorId, pageUrl: lead.pageUrl, timestamp: lead.ts }, { fetch: deps.fetch, env: deps.env });
      const cost = out.failed ? 0 : adapter.priceMicros;
      budget.settle(adapter.priceMicros, cost);
      groupCost += cost;
      addCall(PERSON_IDENTIFY_JOB, adapter.id, `${adapter.id}:${lead.ipKey}:${lead.ts}`, cost, out.failed ?? "completed");
      if (out.failed) {
        addAudit(state, { at, kind: "lookup", supplier: adapter.label, outcome: "failed", why: `${why} The supplier call failed: ${out.failed}.`, subject: lead.ipKey, costMicros: cost, country: cc });
        result.failed++;
        continue;
      }
      const ranked = out.candidates.filter((c) => (c.confidence ?? 1) >= pl.minConfidence).sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
      best = ranked[0] ?? null;
      if (!best) {
        addAudit(state, { at, kind: "lookup", supplier: adapter.label, outcome: "no_match", why, subject: lead.ipKey, costMicros: cost, country: cc });
        result.noMatch++;
        result.spentMicros += cost;
        removeGroup(items);
        continue;
      }
      best = { ...best, costMicros: cost };
    }

    if (!best) {
      // No known email and no supplier configured: nothing can identify this visitor.
      addAudit(state, { at, kind: "lookup", supplier: "-", outcome: "no_match", why: `${why} No known email hash and no supplier configured.`, subject: lead.ipKey, costMicros: 0, country: cc });
      result.noMatch++;
      removeGroup(items);
      continue;
    }

    // 5. looot enrichment: a hash and no name yet.
    if (pl.enrich.enabled && deps.looot && canEnrichWith(best.emailSha256) && !best.name && !best.linkedinUrl) {
      const price = Math.round(pl.enrich.priceUsd * 1_000_000);
      if (!budget.reserve(price)) {
        addAudit(state, { at, kind: "lookup", supplier: pl.enrich.endpointId, outcome: "cap_reached", why: "The enrichment call would pass the spend cap. The visitor stays queued.", subject: lead.ipKey, costMicros: 0, country: cc });
        result.notRun++;
        result.spentMicros += groupCost;
        continue;
      }
      const key = enrichKey(pl.enrich.endpointId, best.emailSha256);
      let run;
      try {
        run = await deps.looot.runAndWait(pl.enrich.endpointId, enrichInput(best.emailSha256, pl.enrich), key, { fallback: false });
      } catch (e) {
        run = { runId: "", status: "failed", error: { code: "request_failed", message: (e as Error).message } };
      }
      const got = candidateFromRun(run);
      budget.settle(price, got.costMicros);
      groupCost += got.costMicros;
      addCall(PERSON_ENRICH_JOB, pl.enrich.endpointId, key, got.costMicros, run.status);
      if (got.candidate) {
        best = { ...best, ...Object.fromEntries(Object.entries(got.candidate).filter(([, v]) => v !== undefined)), supplier: `${best.supplier}+${pl.enrich.endpointId}`, costMicros: best.costMicros + got.costMicros };
        supplierLabel = best.supplier;
      } else {
        best = { ...best, costMicros: best.costMicros + got.costMicros };
      }
    }
    result.spentMicros += groupCost;

    // 6. Suppression on the final identity.
    if (isSuppressed(state, { emailSha256: best.emailSha256, emailMd5: best.emailMd5, workEmail: best.workEmail, companyDomain: best.companyDomain })) {
      addAudit(state, { at, kind: "lookup", supplier: supplierLabel, outcome: "suppressed", why: "The identity matched the suppression list and was discarded.", subject: lead.ipKey, costMicros: groupCost, country: cc });
      if (vidKey) delete p.known[vidKey];
      removeGroup(items);
      continue;
    }

    // 7. Store the person.
    const rec = upsertPerson(state, config, best, { vidKey, ipKeys, visits, now: deps.now, companyDomain: companyOf(state, lead.ipKey) });
    addAudit(state, { at, kind: "lookup", supplier: supplierLabel, outcome: "identified", why, subject: rec.id, costMicros: groupCost, country: cc });
    result.identified++;
    removeGroup(items);
  }
  p.pending = p.pending.filter((x) => !done.has(x.id));
  purgePerson(state, config, deps.now);
  return result;
}

/** The company the company-level lookup attributed this address to, if any. */
function companyOf(state: State, ipKey: string): string | undefined {
  const r = state.resolutions[ipKey];
  return r?.status === "company" ? r.domain : undefined;
}

function attachVisits(rec: PersonRecord, visits: { path: string; ts: string }[], ipKeys: string[]): void {
  const seen = new Set(rec.visits.map((v) => `${v.ts}|${v.path}`));
  for (const v of visits) if (!seen.has(`${v.ts}|${v.path}`)) rec.visits.push(v);
  rec.visits.sort((a, b) => a.ts.localeCompare(b.ts));
  if (rec.visits.length > MAX_PERSON_VISITS) rec.visits.splice(0, rec.visits.length - MAX_PERSON_VISITS);
  for (const k of ipKeys) if (!rec.ipKeys.includes(k)) rec.ipKeys.push(k);
  rec.lastSeen = visits.reduce((m, v) => (v.ts > m ? v.ts : m), rec.lastSeen);
}

function upsertPerson(state: State, config: RevealConfig, c: PersonCandidate, ctx: { vidKey: string; ipKeys: string[]; visits: { path: string; ts: string }[]; now: Date; companyDomain?: string }): PersonRecord {
  const p = ensurePerson(state);
  const id = shortId(c.emailSha256 ?? c.linkedinUrl ?? c.name ?? ctx.vidKey ?? ctx.ipKeys[0] ?? "x");
  const rec: PersonRecord = p.people[id] ?? { id, supplier: c.supplier, costMicros: 0, firstSeen: ctx.now.toISOString(), lastSeen: ctx.now.toISOString(), vidKeys: [], ipKeys: [], visits: [] };
  rec.emailSha256 = c.emailSha256 ?? rec.emailSha256;
  rec.emailMd5 = c.emailMd5 ?? (c.emailSha256 === rec.emailSha256 ? rec.emailMd5 : undefined);
  if (c.workEmail) {
    rec.workEmailSha256 = sha256Email(c.workEmail);
    if (config.personLevel.storeWorkEmail) rec.workEmail = c.workEmail;
  }
  rec.name = c.name ?? rec.name;
  rec.linkedinUrl = c.linkedinUrl ?? rec.linkedinUrl;
  rec.title = c.title ?? rec.title;
  rec.company = c.company ?? rec.company;
  rec.companyDomain = c.companyDomain ?? rec.companyDomain ?? ctx.companyDomain;
  rec.confidence = c.confidence ?? rec.confidence;
  rec.supplier = c.supplier;
  rec.costMicros += c.costMicros;
  if (ctx.vidKey && !rec.vidKeys.includes(ctx.vidKey)) rec.vidKeys.push(ctx.vidKey);
  p.people[id] = rec;
  attachVisits(rec, ctx.visits, ctx.ipKeys);
  for (const k of Object.keys(rec)) if ((rec as unknown as Record<string, unknown>)[k] === undefined) delete (rec as unknown as Record<string, unknown>)[k];
  return rec;
}
