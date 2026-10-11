import type { RevealConfig } from "../config";
import { BLOCKED_COUNTRIES, CONDITION_IDS } from "./schema";

/** true only when the switch is on, the acknowledgement date is set and every condition is ticked. */
export function isPersonLevelActive(config: RevealConfig): boolean {
  const p = config.personLevel;
  return p.enabled && /^\d{4}-\d{2}-\d{2}$/.test(p.acknowledgedTerms) && CONDITION_IDS.every((id) => p.acknowledgedConditions.includes(id));
}

export type RegionVerdict = { allowed: true } | { allowed: false; reason: "blocked_region" | "region_not_allowed" | "region_unknown" };

/** US-only gate. EU, EEA, UK and CH are refused even if a hand-edited config lists them. An unknown country is refused. */
export function regionVerdict(country: string | undefined, config: RevealConfig): RegionVerdict {
  const c = country?.trim().toUpperCase();
  if (!c) return { allowed: false, reason: "region_unknown" };
  if (BLOCKED_COUNTRIES.has(c)) return { allowed: false, reason: "blocked_region" };
  if (!config.personLevel.allowedRegions.some((r) => r.toUpperCase() === c)) return { allowed: false, reason: "region_not_allowed" };
  return { allowed: true };
}

export interface BrowserSignals {
  gpc: boolean;
  dnt: boolean;
  personConsent: boolean;
}

export type SignalVerdict = { ok: true } | { ok: false; reason: "gpc" | "dnt" | "no_consent" };

/** Global Privacy Control and Do Not Track always stop a lookup. A missing consent signal stops it while requireConsent is on. */
export function signalVerdict(s: BrowserSignals, config: RevealConfig): SignalVerdict {
  if (s.gpc) return { ok: false, reason: "gpc" };
  if (s.dnt) return { ok: false, reason: "dnt" };
  if (config.personLevel.requireConsent && !s.personConsent) return { ok: false, reason: "no_consent" };
  return { ok: true };
}
