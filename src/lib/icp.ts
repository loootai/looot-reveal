import type { IcpSignal, RevealConfig } from "./config";
import type { CompanyProfile, IcpResult, IcpSignalResult, IpInfo } from "./types";

export interface IcpContext {
  profile?: CompanyProfile;
  /** Provider that supplied the profile, and what its call cost. */
  profileProvider: string;
  profileCostMicros: number;
  info?: IpInfo;
  lookupProvider: string;
  lookupCostMicros: number;
  /** Paths the company viewed. */
  paths: string[];
}

const norm = (s: string) => s.trim().toLowerCase();
const hit = (haystack: string, needles: string[]) => needles.some((n) => norm(haystack).includes(norm(n)));

function evalSignal(s: IcpSignal, c: IcpContext): IcpSignalResult {
  const base = { id: s.id, label: s.label, weight: s.weight };
  if (s.kind === "pages") {
    const seen = c.paths.filter((p) => s.paths.some((m) => p === m || p.startsWith(m)));
    return { ...base, matched: seen.length > 0, value: seen.length > 0 ? [...new Set(seen)].join(", ") : "none of " + s.paths.join(", "), provider: "your visit data", costMicros: 0 };
  }
  if (s.kind === "employees") {
    const n = c.profile?.employees;
    const matched = n !== undefined && n >= s.min && (s.max === undefined || n <= s.max);
    return { ...base, matched, value: n === undefined ? "unknown" : String(n), provider: c.profileProvider, costMicros: c.profileCostMicros };
  }
  // text signals: country can come from the IP lookup when the company profile has none
  if (s.field === "country") {
    const fromProfile = c.profile?.country;
    const value = fromProfile ?? c.info?.country;
    const fromIp = !fromProfile && Boolean(c.info?.country);
    return { ...base, matched: value !== undefined && s.anyOf.some((a) => norm(a) === norm(value)), value: value ?? "unknown", provider: fromIp ? c.lookupProvider : c.profileProvider, costMicros: fromIp ? c.lookupCostMicros : c.profileCostMicros };
  }
  const value = c.profile?.[s.field];
  return { ...base, matched: value !== undefined && hit(value, s.anyOf), value: value ? value.slice(0, 80) : "unknown", provider: c.profileProvider, costMicros: c.profileCostMicros };
}

/** Scores a company against the ICP in the config. Every signal is listed with its source, weight and cost. */
export function scoreIcp(config: RevealConfig, ctx: IcpContext): IcpResult {
  const signals = config.icp.signals.map((s) => evalSignal(s, ctx));
  const score = signals.filter((s) => s.matched).reduce((n, s) => n + s.weight, 0);
  const maxScore = signals.reduce((n, s) => n + s.weight, 0);
  return { matched: signals.length > 0 && score >= config.icp.threshold, score, maxScore, threshold: config.icp.threshold, signals };
}
