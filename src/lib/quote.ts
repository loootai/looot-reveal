import type { RevealConfig } from "./config";
import { inCidr, isNonPublicIp } from "./ip";
import { COMPANY_ENRICH, IP_LOOKUP_JOB } from "./sources";
import type { Resolution } from "./types";
import { activeProviders, isFresh, priceMicros } from "./waterfall";

export interface QuoteLine {
  label: string;
  jobId: string;
  /** Provider id for a lookup line. */
  providerId?: string;
  endpointId: string;
  calls: number;
  priceMicros: number;
}

export interface Quote {
  uniqueIps: number;
  cachedIps: number;
  privateIps: number;
  /** IPs inside a skipCidrs range. Never looked up. */
  skippedIps: number;
  lines: QuoteLine[];
  /** The most this run can cost: every provider is called for every new IP, and every IP is a company that gets enriched. */
  maxMicros: number;
  /** Spend cap for the run. */
  capMicros: number;
  /** true when the worst case is above the cap, so the run will stop early. */
  capBinds: boolean;
  /** Providers in call order, for display. */
  order: { id: string; label: string; priceMicros: number }[];
}

/**
 * Prices a run before it happens. The worst case calls every enabled provider for every new IP,
 * then enriches each as a company. Most addresses stop at the first provider that says "ISP",
 * "hosting" or "VPN", so the real cost is usually far lower.
 */
export function buildQuote(ips: string[], cache: Record<string, Resolution>, config: RevealConfig, capMicros: number, now: Date = new Date()): Quote {
  const unique = [...new Set(ips)];
  const privateIps = unique.filter(isNonPublicIp).length;
  const publicIps = unique.filter((ip) => !isNonPublicIp(ip));
  const skipped = publicIps.filter((ip) => config.waterfall.skipCidrs.some((c) => inCidr(ip, c)));
  const open = publicIps.filter((ip) => !skipped.includes(ip));
  const fresh = open.filter((ip) => !cache[ip] || !isFresh(cache[ip], config, now));
  const providers = activeProviders(config);
  const lines: QuoteLine[] = providers.map((p) => ({ label: p.label, jobId: IP_LOOKUP_JOB, providerId: p.id, endpointId: p.endpointId, calls: fresh.length, priceMicros: priceMicros(p) }));
  if (config.enrich) lines.push({ label: "Company enrichment, at most one per new IP", jobId: COMPANY_ENRICH.jobId, endpointId: COMPANY_ENRICH.endpointId, calls: fresh.length, priceMicros: COMPANY_ENRICH.priceMicros });
  const maxMicros = lines.reduce((n, l) => n + l.calls * l.priceMicros, 0);
  return {
    uniqueIps: unique.length,
    cachedIps: open.length - fresh.length,
    privateIps,
    skippedIps: skipped.length,
    lines,
    maxMicros,
    capMicros,
    capBinds: maxMicros > capMicros,
    order: providers.map((p) => ({ id: p.id, label: p.label, priceMicros: priceMicros(p) })),
  };
}
