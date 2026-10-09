import type { RevealConfig } from "./config";
import { isNonPublicIp } from "./ip";
import { JOBS } from "./sources";
import type { Resolution } from "./types";

export interface QuoteLine {
  label: string;
  jobId: string;
  endpointId: string;
  calls: number;
  priceMicros: number;
}

export interface Quote {
  uniqueIps: number;
  cachedIps: number;
  privateIps: number;
  lines: QuoteLine[];
  /** The most this run can cost: every new IP is a company and every company is enriched. */
  maxMicros: number;
  capMicros: number;
  /** true when the worst case is above the cap, so the run will stop early. */
  capBinds: boolean;
}

/**
 * Prices a run before it happens. The lookup count is exact. The enrichment count is a ceiling
 * because most addresses belong to ISPs and are dropped before any company call.
 */
export function buildQuote(ips: string[], cache: Record<string, Resolution>, config: RevealConfig, capMicros: number): Quote {
  const unique = [...new Set(ips)];
  const privateIps = unique.filter(isNonPublicIp).length;
  const publicIps = unique.filter((ip) => !isNonPublicIp(ip));
  const fresh = publicIps.filter((ip) => !cache[ip] || cache[ip].status === "pending" || cache[ip].status === "failed");
  const lookup = config.lookup === "ipinfo-lite" ? JOBS.ipLookupLite : JOBS.ipLookup;
  const lines: QuoteLine[] = [{ label: `${lookup.label}, one per new IP`, jobId: lookup.jobId, endpointId: lookup.endpointId, calls: fresh.length, priceMicros: lookup.priceMicros }];
  if (config.enrich) lines.push({ label: "Company enrichment, at most one per new IP", jobId: JOBS.companyEnrich.jobId, endpointId: JOBS.companyEnrich.endpointId, calls: fresh.length, priceMicros: JOBS.companyEnrich.priceMicros });
  const maxMicros = lines.reduce((n, l) => n + l.calls * l.priceMicros, 0);
  return { uniqueIps: unique.length, cachedIps: publicIps.length - fresh.length, privateIps, lines, maxMicros, capMicros, capBinds: maxMicros > capMicros };
}
