import type { ProviderConfig, RevealConfig } from "./config";
import { inCidr, isNonPublicIp } from "./ip";
import type { Ledger } from "./budget";
import type { LoootRun, LoootRunner } from "./looot";
import { toMicros } from "./money";
import { paidCall } from "./paidCall";
import { parseIpInfo, parsePdlIp } from "./parse";
import type { AnswerOutcome, Confidence, ExcludeReason, IpInfo, ProviderAnswer, Resolution } from "./types";

const PENDING = new Set(["queued", "running", "reconciliation_pending", "pending_provider"]);

/** Stable per (provider, IP): the same IP always maps to the same key, so a retry never pays twice. */
export function lookupKey(providerId: string, ip: string, salt = ""): string {
  return `reveal:ip.lookup:${providerId}:${ip}${salt}`;
}

/**
 * Key suffix for a lookup that replaces an answer past the cache window. It names the cache period
 * (floor of time over cacheDays), not a date, so the same refresh asked twice in one period carries one key
 * and looot replays it without a second charge. The next period gets a new key, which is the fresh lookup.
 */
export function refreshSalt(now: Date, cacheDays: number): string {
  return `:p${Math.floor(now.getTime() / (Math.max(1, cacheDays) * 86_400_000))}`;
}

/** The providers that will be called, in order. Disabled ones are skipped. */
export const activeProviders = (config: RevealConfig): ProviderConfig[] => config.waterfall.providers.filter((p) => p.enabled);

/** Dollar price of a provider in micro-dollars. */
export const priceMicros = (p: ProviderConfig): number => Math.round(p.priceUsd * 1_000_000);

/** true when a stored answer is still inside the cache window. */
export function isFresh(res: Resolution, config: RevealConfig, now: Date): boolean {
  if (res.status !== "company" && res.status !== "excluded") return false;
  const ageMs = now.getTime() - new Date(res.resolvedAt).getTime();
  return ageMs <= config.waterfall.cacheDays * 86_400_000;
}

/** Why an address cannot be a visiting company, or undefined when it can. Consumer ISPs, mobile carriers, hosting and VPNs cannot. */
export function classify(info: IpInfo, config: RevealConfig): { reason?: ExcludeReason } {
  if (info.bogon) return { reason: "bogon" };
  if (info.vpn || info.proxy || info.tor || info.relay) return { reason: "vpn" };
  if (info.mobile) return { reason: "mobile" };
  if (info.kind === "isp") return { reason: "isp" };
  if (info.kind === "hosting" || info.hosting) return { reason: "hosting" };
  if (info.kind === "unknown" && info.name) {
    const n = info.name.toLowerCase();
    if (config.networkNameHints.some((h) => n.includes(h.toLowerCase()))) return { reason: "isp" };
  }
  if (!info.domain) return { reason: "no_domain" };
  return {};
}

function parseFor(p: ProviderConfig, ip: string, result: unknown): IpInfo {
  return p.adapter === "pdl" ? parsePdlIp(ip, result) : parseIpInfo(ip, result);
}

const looksLikeNoMatch = (run: LoootRun): boolean => /not.?found|no.?match|\b404\b/i.test(`${run.error?.code ?? ""} ${run.error?.message ?? ""}`);

/** Turns one finished run into an answer. Exported for tests. */
export function toAnswer(p: ProviderConfig, ip: string, run: LoootRun, config: RevealConfig): { answer: ProviderAnswer; info?: IpInfo } {
  const cost = toMicros(run.actualCost);
  const base = { provider: p.id, endpointId: p.endpointId, costMicros: cost };
  if (PENDING.has(run.status)) return { answer: { ...base, outcome: "pending" } };
  if (run.status !== "completed") return { answer: { ...base, outcome: run.status === "failed" && cost === 0 && looksLikeNoMatch(run) ? "none" : "failed" } };
  const info = parseFor(p, ip, run.result);
  const { reason } = classify(info, config);
  if (reason === "no_domain") return { answer: { ...base, outcome: "none", name: info.name }, info };
  if (reason) return { answer: { ...base, outcome: "excluded", reason, name: info.name, domain: info.domain }, info };
  const strong = p.trust === "company" || (p.trust === "network_type" && ["business", "education", "government"].includes(info.kind));
  return { answer: { ...base, outcome: strong ? "match" : "weak", name: info.name, domain: info.domain }, info };
}

/** Two domains name the same company when they are equal or one is a subdomain of the other. */
export const sameCompany = (a: string, b: string): boolean => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);

/** Tracks spend and what is promised to calls that are still running, so parallel lookups cannot pass the cap together. */
export class Budget {
  spent = 0;
  reserved = 0;
  constructor(readonly capMicros: number) {}
  /** Reserves the list price of a call. false when the call could pass the cap. Free calls always fit. */
  reserve(micros: number): boolean {
    if (micros > 0 && this.spent + this.reserved + micros > this.capMicros) return false;
    this.reserved += micros;
    return true;
  }
  /** Replaces the reservation with the real cost. */
  settle(reservedMicros: number, actualMicros: number): void {
    this.reserved -= reservedMicros;
    this.spent += actualMicros;
  }
  get room(): number {
    return this.capMicros - this.spent - this.reserved;
  }
}

export interface WalkResult {
  resolution: Resolution;
  /** Cost of every call made, per provider, for the call log. */
  calls: { providerId: string; endpointId: string; key: string; costMicros: number; status: string }[];
  /** true when the cap or the period budget stopped the walk before a conclusion, so the address stays pending. */
  capStopped: boolean;
  /** The refusal text when the period budget (not the run cap) stopped the walk. */
  budgetMessage?: string;
}

/**
 * Walks the enabled providers in order for one IP. Stops at the first ISP, mobile, hosting or VPN
 * verdict (nothing more is spent), and at the first confident company match unless crossCheck asks
 * for a second opinion. Never makes a call the budget cannot cover.
 */
export async function walkProviders(ip: string, config: RevealConfig, looot: LoootRunner, budget: Budget, now: Date, keySalt = "", ledger?: Ledger): Promise<WalkResult> {
  const nowIso = now.toISOString();
  let budgetMessage: string | undefined;
  const done = (r: Omit<Resolution, "resolvedAt">, calls: WalkResult["calls"], capStopped = false): WalkResult => ({ resolution: { ...r, resolvedAt: nowIso }, calls, capStopped, ...(budgetMessage ? { budgetMessage } : {}) });
  if (isNonPublicIp(ip)) return done({ status: "excluded", reason: "private_ip", costMicros: 0 }, []);
  if (config.waterfall.skipCidrs.some((c) => inCidr(ip, c))) return done({ status: "excluded", reason: "skipped_range", costMicros: 0 }, []);

  const answers: ProviderAnswer[] = [];
  const infos = new Map<string, IpInfo>();
  const calls: WalkResult["calls"] = [];
  const trustOf = new Map<string, ProviderConfig["trust"]>();
  let capStopped = false;
  let confidentAt = -1;
  let checkedAfterConfident = false;

  for (const p of activeProviders(config)) {
    if (confidentAt >= 0) {
      // A confident match ends the walk. With crossCheck, one more company-level provider is asked for a second opinion.
      if (!config.waterfall.crossCheck || checkedAfterConfident || p.trust === "asn_owner") continue;
      checkedAfterConfident = true;
    }
    const price = priceMicros(p);
    if (!budget.reserve(price)) {
      capStopped = true;
      break;
    }
    const key = lookupKey(p.id, ip, keySalt);
    // Order of checks: the run cap above, then the period budget, then the call.
    const paid = await paidCall({ looot, ledger, endpointId: p.endpointId, input: { ip }, key, priceMicros: price, now, fallback: false });
    if (paid.refused !== null) {
      budget.settle(price, 0);
      budgetMessage = paid.refused;
      capStopped = true;
      break;
    }
    const run = paid.run;
    const { answer, info } = toAnswer(p, ip, run, config);
    budget.settle(price, answer.costMicros);
    answers.push(answer);
    trustOf.set(p.id, p.trust);
    if (info) infos.set(p.id, info);
    calls.push({ providerId: p.id, endpointId: p.endpointId, key, costMicros: answer.costMicros, status: run.status });
    if (answer.outcome === "excluded") break;
    if (answer.outcome === "match" && confidentAt < 0) confidentAt = answers.length - 1;
  }

  const costMicros = answers.reduce((n, a) => n + a.costMicros, 0);
  const excluded = answers.find((a) => a.outcome === "excluded");
  if (excluded) {
    return done({ status: "excluded", reason: excluded.reason, info: infos.get(excluded.provider), lookupProvider: excluded.provider, answers, costMicros }, calls);
  }

  const withDomain = answers.filter((a) => (a.outcome === "match" || a.outcome === "weak") && a.domain);
  if (withDomain.length > 0) {
    const primary = withDomain.find((a) => a.outcome === "match") ?? withDomain[0];
    // An ASN owner is the registered owner of the network, not a witness for the company, so it never counts as a disagreement.
    const witnesses = withDomain.filter((a) => trustOf.get(a.provider) !== "asn_owner");
    const others = witnesses.filter((a) => !sameCompany(a.domain!, primary.domain!));
    const confidence: Confidence = others.length > 0 ? "low" : primary.outcome === "match" ? "high" : "medium";
    const resolution: Omit<Resolution, "resolvedAt"> = {
      status: "company",
      info: infos.get(primary.provider),
      domain: primary.domain,
      name: primary.name,
      lookupProvider: primary.provider,
      confidence,
      answers,
      costMicros,
      ...(others.length > 0 ? { alternatives: others.map((a) => ({ provider: a.provider, name: a.name, domain: a.domain! })) } : {}),
    };
    // Weak answer and the cap stopped the next provider: keep it pending so a later run with more room can finish the job.
    if (capStopped && primary.outcome !== "match") return done({ status: "pending", answers, costMicros }, calls, true);
    return done(resolution, calls);
  }

  if (capStopped) return done({ status: "pending", answers, costMicros }, calls, true);
  const outcomes = new Set<AnswerOutcome>(answers.map((a) => a.outcome));
  if (outcomes.has("pending")) return done({ status: "pending", answers, costMicros }, calls);
  if (outcomes.has("failed") || answers.length === 0) return done({ status: "failed", reason: "lookup_failed", answers, costMicros }, calls);
  return done({ status: "excluded", reason: "no_domain", answers, costMicros }, calls);
}
