import type { Ledger } from "./budget";
import type { RevealConfig } from "./config";
import { TERMINAL_STATUSES, type LoootRun, type LoootRunner } from "./looot";
import { toMicros } from "./money";
import { paidCall } from "./paidCall";
import { parseCompany } from "./parse";
import { COMPANY_ENRICH, IP_LOOKUP_JOB } from "./sources";
import type { CallRecord, CompanyProfile, Resolution } from "./types";
import { Budget, classify, isFresh, lookupKey, refreshSalt, walkProviders } from "./waterfall";

export { classify, lookupKey };

export interface CompanyEntry {
  profile: CompanyProfile;
  status: "done" | "pending" | "failed" | "skipped";
  costMicros: number;
  provider: string;
  resolvedAt: string;
}

export interface EngineInput {
  ips: string[];
  looot: LoootRunner;
  config: RevealConfig;
  /** Resolutions already stored, by IP. A done or excluded one inside the cache window is never looked up again. */
  cache: Record<string, Resolution>;
  companies: Record<string, CompanyEntry>;
  /** Spend cap for this run, in micro-dollars. Always from server config, never from a request. */
  capMicros: number;
  /** Period budget: reservations and used spend across runs. Left out in demo mode and in tests that do not need it. */
  ledger?: Ledger;
  now: Date;
  /** Suffix added to idempotency keys, to force a fresh call. */
  keySalt?: string;
}

export interface EngineOutput {
  resolutions: Record<string, Resolution>;
  companies: Record<string, CompanyEntry>;
  calls: CallRecord[];
  spentMicros: number;
  /** IPs and domains that were not run because the next call would pass the cap. */
  notRun: { ips: string[]; domains: string[] };
  /** The refusal text when the period budget stopped a call. */
  budgetMessage: string | null;
}

const PENDING = new Set(["queued", "running", "reconciliation_pending", "pending_provider"]);

export function enrichKey(domain: string, salt = ""): string {
  return `reveal:company.enrich:${domain}${salt}`;
}

const providerOf = (run: LoootRun, fallback: string): string => {
  for (const k of ["providerId", "provider", "endpointId"]) if (typeof run[k] === "string" && run[k]) return run[k] as string;
  return fallback;
};

/**
 * Resolves each unique IP through the provider waterfall, then enriches each new company domain once.
 * A cached answer inside `waterfall.cacheDays` is reused. The cap is checked before every call.
 * A run still in progress is stored as pending, never as failed.
 */
export async function resolveIps(input: EngineInput): Promise<EngineOutput> {
  const { looot, config, now } = input;
  const nowIso = now.toISOString();
  const resolutions: Record<string, Resolution> = { ...input.cache };
  const companies: Record<string, CompanyEntry> = { ...input.companies };
  const calls: CallRecord[] = [];
  const notRun = { ips: [] as string[], domains: [] as string[] };
  const budget = new Budget(input.capMicros);
  const ledger = input.ledger;
  let budgetMessage: string | null = null;

  const todo: { ip: string; salt: string }[] = [];
  for (const ip of new Set(input.ips)) {
    const c = resolutions[ip];
    if (c && isFresh(c, config, now)) continue;
    // A stale answer is looked up again under a key named for the cache period, so the stored run is not replayed.
    // The key holds no date: asking again in the same period sends the same key and is not charged twice.
    const stale = c && (c.status === "company" || c.status === "excluded");
    todo.push({ ip, salt: `${input.keySalt ?? ""}${stale ? refreshSalt(now, config.waterfall.cacheDays) : ""}` });
  }

  const BATCH = 5;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const walks = await Promise.all(batch.map((t) => walkProviders(t.ip, config, looot, budget, now, t.salt, ledger)));
    batch.forEach((t, n) => {
      const w = walks[n];
      if (w.capStopped) notRun.ips.push(t.ip);
      if (w.budgetMessage) budgetMessage = w.budgetMessage;
      // An address the cap kept from getting any answer keeps what it had before.
      if (w.capStopped && w.resolution.status === "pending" && (w.resolution.answers?.length ?? 0) === 0) return;
      resolutions[t.ip] = w.resolution;
      for (const c of w.calls) calls.push({ job: IP_LOOKUP_JOB, providerId: c.providerId, key: c.key, costMicros: c.costMicros, status: c.status, at: nowIso });
    });
  }

  if (config.enrich) {
    const domains = [...new Set(Object.values(resolutions).flatMap((r) => (r.status === "company" && r.domain ? [r.domain] : [])))];
    const need = domains.filter((d) => !companies[d] || companies[d].status === "pending" || companies[d].status === "failed");
    for (let i = 0; i < need.length; i += BATCH) {
      const batch = need.slice(i, i + BATCH);
      const go = batch.filter(() => budget.reserve(COMPANY_ENRICH.priceMicros));
      notRun.domains.push(...batch.slice(go.length));
      const runs = await Promise.all(
        go.map(async (d) => {
          const paid = await paidCall({ looot, ledger, endpointId: COMPANY_ENRICH.endpointId, input: { domain: d }, key: enrichKey(d, input.keySalt), priceMicros: COMPANY_ENRICH.priceMicros, now, fallback: true });
          if (paid.refused !== null) {
            budget.settle(COMPANY_ENRICH.priceMicros, 0);
            budgetMessage = paid.refused;
          }
          return paid;
        }),
      );
      const refused = new Set<string>();
      go.forEach((d, n) => {
        const paid = runs[n];
        if (paid.refused !== null) {
          refused.add(d);
          notRun.domains.push(d);
          return;
        }
        const run = paid.run;
        const cost = toMicros(run.actualCost);
        budget.settle(COMPANY_ENRICH.priceMicros, cost);
        const provider = providerOf(run, COMPANY_ENRICH.jobId);
        calls.push({ job: COMPANY_ENRICH.jobId, providerId: provider, key: enrichKey(d, input.keySalt), costMicros: cost, status: run.status, at: nowIso });
        const status = run.status === "completed" ? "done" : PENDING.has(run.status) ? "pending" : "failed";
        companies[d] = { profile: status === "done" ? parseCompany(d, run.result) : { domain: d }, status, costMicros: cost, provider, resolvedAt: nowIso };
      });
      if (refused.size > 0 || go.length < batch.length) {
        notRun.domains.push(...need.slice(i + BATCH));
        break;
      }
    }
  }

  return { resolutions, companies, calls, spentMicros: budget.spent, notRun, budgetMessage };
}

export { TERMINAL_STATUSES };
