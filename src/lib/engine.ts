import type { RevealConfig } from "./config";
import { isNonPublicIp } from "./ip";
import { LoootError, TERMINAL_STATUSES, type LoootRun, type LoootRunner } from "./looot";
import { toMicros } from "./money";
import { parseCompany, parseIpInfo } from "./parse";
import { JOBS } from "./sources";
import type { CallRecord, CompanyProfile, ExcludeReason, IpInfo, Resolution } from "./types";

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
  /** Resolutions already stored, by IP. Done and excluded ones are never looked up again. */
  cache: Record<string, Resolution>;
  companies: Record<string, CompanyEntry>;
  /** Spend cap for this run, in micro-dollars. */
  capMicros: number;
  now: Date;
  /** Suffix added to idempotency keys, to force a fresh call after a cache expiry. */
  keySalt?: string;
}

export interface EngineOutput {
  resolutions: Record<string, Resolution>;
  companies: Record<string, CompanyEntry>;
  calls: CallRecord[];
  spentMicros: number;
  /** IPs and domains that were not run because the next call would pass the cap. */
  notRun: { ips: string[]; domains: string[] };
}

const PENDING = new Set(["queued", "running", "reconciliation_pending", "pending_provider"]);

/** Stable per (input, job): the same IP always maps to the same key, so a retry never pays twice. */
export function lookupKey(ip: string, salt = ""): string {
  return `reveal:ip.lookup:${ip}${salt}`;
}
export function enrichKey(domain: string, salt = ""): string {
  return `reveal:company.enrich:${domain}${salt}`;
}

const lookupJob = (config: RevealConfig) => (config.lookup === "ipinfo-lite" ? JOBS.ipLookupLite : JOBS.ipLookup);

/** Decides whether an IP's owner can be a visiting company. Consumer ISPs, hosting and VPNs cannot. */
export function classify(info: IpInfo, config: RevealConfig): { reason?: ExcludeReason } {
  if (info.bogon) return { reason: "bogon" };
  if (info.vpn || info.proxy || info.tor || info.relay) return { reason: "vpn" };
  if (info.kind === "isp") return { reason: "isp" };
  if (info.kind === "hosting" || info.hosting) return { reason: "hosting" };
  if (info.kind === "unknown" && info.name) {
    const n = info.name.toLowerCase();
    if (config.networkNameHints.some((h) => n.includes(h.toLowerCase()))) return { reason: "isp" };
  }
  if (!info.domain) return { reason: "no_domain" };
  return {};
}

async function call(looot: LoootRunner, endpointId: string, input: Record<string, unknown>, key: string, fallback: boolean): Promise<LoootRun> {
  try {
    return await looot.runAndWait(endpointId, input, key, { fallback });
  } catch (e) {
    const err = e instanceof LoootError ? e : null;
    return { runId: "", status: "failed", error: { code: err?.code ?? "request_failed", message: (e as Error).message } };
  }
}

const providerOf = (run: LoootRun, fallback: string): string => {
  for (const k of ["providerId", "provider", "endpointId"]) if (typeof run[k] === "string" && run[k]) return run[k] as string;
  return fallback;
};

/**
 * Resolves each unique IP to a company, then enriches each new company domain once.
 * Checks the cap before every call. A run still in progress is stored as pending, never as failed.
 */
export async function resolveIps(input: EngineInput): Promise<EngineOutput> {
  const { looot, config, now } = input;
  const nowIso = now.toISOString();
  const resolutions: Record<string, Resolution> = { ...input.cache };
  const companies: Record<string, CompanyEntry> = { ...input.companies };
  const calls: CallRecord[] = [];
  const notRun = { ips: [] as string[], domains: [] as string[] };
  let spent = 0;
  const lookup = lookupJob(config);

  const unique = [...new Set(input.ips)];
  const todo: string[] = [];
  for (const ip of unique) {
    if (isNonPublicIp(ip)) {
      resolutions[ip] = { status: "excluded", reason: "private_ip", costMicros: 0, resolvedAt: nowIso };
      continue;
    }
    const c = resolutions[ip];
    if (c && (c.status === "company" || c.status === "excluded")) continue;
    todo.push(ip);
  }

  const room = () => input.capMicros - spent;
  const BATCH = 5;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const fits = lookup.priceMicros === 0 ? batch.length : Math.max(0, Math.floor(room() / lookup.priceMicros));
    const now5 = batch.slice(0, fits);
    notRun.ips.push(...batch.slice(fits));
    const runs = await Promise.all(now5.map((ip) => call(looot, lookup.endpointId, { ip }, lookupKey(ip, input.keySalt), false)));
    now5.forEach((ip, n) => {
      const run = runs[n];
      const cost = toMicros(run.actualCost);
      spent += cost;
      calls.push({ job: lookup.jobId, providerId: lookup.providerId, key: lookupKey(ip, input.keySalt), costMicros: cost, status: run.status, at: nowIso });
      if (run.status === "completed") {
        const info = parseIpInfo(ip, run.result);
        const { reason } = classify(info, config);
        resolutions[ip] = reason
          ? { status: "excluded", reason, info, lookupProvider: lookup.providerId, costMicros: cost, resolvedAt: nowIso }
          : { status: "company", info, domain: info.domain, name: info.name, lookupProvider: lookup.providerId, costMicros: cost, resolvedAt: nowIso };
      } else if (PENDING.has(run.status)) {
        resolutions[ip] = { status: "pending", costMicros: cost, resolvedAt: nowIso };
      } else {
        resolutions[ip] = { status: "failed", reason: "lookup_failed", costMicros: cost, resolvedAt: nowIso };
      }
    });
    if (fits < batch.length) {
      notRun.ips.push(...todo.slice(i + BATCH));
      break;
    }
  }

  if (config.enrich) {
    const domains = [...new Set(Object.values(resolutions).flatMap((r) => (r.status === "company" && r.domain ? [r.domain] : [])))];
    const need = domains.filter((d) => !companies[d] || companies[d].status === "pending" || companies[d].status === "failed");
    const price = JOBS.companyEnrich.priceMicros;
    for (let i = 0; i < need.length; i += BATCH) {
      const batch = need.slice(i, i + BATCH);
      const fits = Math.max(0, Math.floor(room() / price));
      const go = batch.slice(0, fits);
      notRun.domains.push(...batch.slice(fits));
      const runs = await Promise.all(go.map((d) => call(looot, JOBS.companyEnrich.endpointId, { domain: d }, enrichKey(d, input.keySalt), true)));
      go.forEach((d, n) => {
        const run = runs[n];
        const cost = toMicros(run.actualCost);
        spent += cost;
        const provider = providerOf(run, JOBS.companyEnrich.jobId);
        calls.push({ job: JOBS.companyEnrich.jobId, providerId: provider, key: enrichKey(d, input.keySalt), costMicros: cost, status: run.status, at: nowIso });
        const status = run.status === "completed" ? "done" : PENDING.has(run.status) ? "pending" : "failed";
        companies[d] = { profile: status === "done" ? parseCompany(d, run.result) : { domain: d }, status, costMicros: cost, provider, resolvedAt: nowIso };
      });
      if (fits < batch.length) {
        notRun.domains.push(...need.slice(i + BATCH));
        break;
      }
    }
  }

  return { resolutions, companies, calls, spentMicros: spent, notRun };
}

export { TERMINAL_STATUSES };
