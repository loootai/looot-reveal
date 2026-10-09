import { createHash, randomBytes } from "node:crypto";
import type { RevealConfig } from "./config";
import { buildQuote, type Quote } from "./quote";
import { resolveIps, type CompanyEntry, type EngineOutput } from "./engine";
import type { LoootRunner } from "./looot";
import type { CallRecord, Resolution, StoredVisit, Visit } from "./types";

/** Everything the app remembers. One JSON file on disk, or memory in demo mode. */
export interface State {
  version: 1;
  /** Random per install. Salts the IP hash so a stored key cannot be matched against a list of IPs. */
  salt: string;
  visits: StoredVisit[];
  /** Raw IPs still waiting to be resolved, by ipKey. Deleted once resolved. */
  pendingIps: Record<string, string>;
  resolutions: Record<string, Resolution>;
  companies: Record<string, CompanyEntry>;
  calls: CallRecord[];
}

export function emptyState(): State {
  return { version: 1, salt: randomBytes(12).toString("hex"), visits: [], pendingIps: {}, resolutions: {}, companies: {}, calls: [] };
}

/** The key a visit is stored under: the raw IP when storeRawIp is on, else a salted hash. */
export function ipKeyOf(ip: string, state: Pick<State, "salt">, config: RevealConfig): string {
  return config.storeRawIp ? ip : createHash("sha256").update(`${state.salt}:${ip}`).digest("hex").slice(0, 16);
}

/** Adds visits. IPs that have no stored answer yet are kept as pending until a run resolves them. */
export function addVisits(state: State, visits: Visit[], config: RevealConfig): { added: number; newIps: number } {
  let newIps = 0;
  for (const v of visits) {
    const key = ipKeyOf(v.ip, state, config);
    state.visits.push({ ipKey: key, path: v.path, ts: v.ts, ...(v.referrer ? { referrer: v.referrer } : {}) });
    const r = state.resolutions[key];
    if (!r || r.status === "pending" || r.status === "failed") {
      if (!state.pendingIps[key]) newIps++;
      state.pendingIps[key] = v.ip;
    }
  }
  return { added: visits.length, newIps };
}

/** Quote for resolving every pending IP. */
export function quotePending(state: State, config: RevealConfig, capMicros: number): Quote {
  const ips = Object.values(state.pendingIps);
  const cache: Record<string, Resolution> = {};
  for (const [key, ip] of Object.entries(state.pendingIps)) if (state.resolutions[key]) cache[ip] = state.resolutions[key];
  return buildQuote(ips, cache, config, capMicros);
}

/** Resolves the pending IPs and writes the answers back. Raw IPs are dropped once an IP has a final answer. */
export async function resolvePending(state: State, config: RevealConfig, looot: LoootRunner, capMicros: number, now: Date): Promise<EngineOutput> {
  const byIp: Record<string, string> = {};
  const cache: Record<string, Resolution> = {};
  for (const [key, ip] of Object.entries(state.pendingIps)) {
    byIp[ip] = key;
    if (state.resolutions[key]) cache[ip] = state.resolutions[key];
  }
  const out = await resolveIps({ ips: Object.keys(byIp), looot, config, cache, companies: state.companies, capMicros, now });
  for (const [ip, res] of Object.entries(out.resolutions)) {
    const key = byIp[ip];
    if (!key) continue;
    // The provider body carries the IP. Without storeRawIp it must not be kept.
    state.resolutions[key] = res.info && !config.storeRawIp ? { ...res, info: { ...res.info, ip: "" } } : res;
    if (res.status === "company" || res.status === "excluded") delete state.pendingIps[key];
  }
  state.companies = out.companies;
  // The idempotency key holds the raw IP. Keep only a hash of it when raw IPs are not stored.
  state.calls.push(...out.calls.map((c) => (config.storeRawIp ? c : { ...c, key: createHash("sha256").update(c.key).digest("hex").slice(0, 12) })));
  return out;
}

/** Deletes visits, answers and call records older than the retention window. Returns what it removed. */
export function purgeOld(state: State, config: RevealConfig, now: Date): { visits: number; resolutions: number } {
  const cutoff = new Date(now.getTime() - config.retentionDays * 86_400_000).toISOString();
  const before = { visits: state.visits.length, resolutions: Object.keys(state.resolutions).length };
  state.visits = state.visits.filter((v) => v.ts >= cutoff);
  const live = new Set(state.visits.map((v) => v.ipKey));
  for (const k of Object.keys(state.resolutions)) if (!live.has(k) && !state.pendingIps[k]) delete state.resolutions[k];
  const kept = new Set(Object.values(state.resolutions).map((r) => r.domain));
  for (const d of Object.keys(state.companies)) if (!kept.has(d)) delete state.companies[d];
  state.calls = state.calls.filter((c) => c.at >= cutoff);
  return { visits: before.visits - state.visits.length, resolutions: before.resolutions - Object.keys(state.resolutions).length };
}
