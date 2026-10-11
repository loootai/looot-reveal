import type { RevealConfig } from "../config";
import type { State } from "../state";
import { isPersonLevelActive } from "./gates";
import { PERSON_IDENTIFY_JOB, quotePersonRun, type PersonQuote } from "./engine";
import { PERSON_ENRICH_JOB } from "./enrich";
import type { AuditEntry, SuppressionEntry } from "./types";

export interface PersonRow {
  id: string;
  name: string;
  title?: string;
  company?: string;
  companyDomain?: string;
  linkedinUrl?: string;
  /** First 12 characters of the SHA-256, enough to tell people apart without showing the full hash. */
  emailHashShort?: string;
  hasStoredEmail: boolean;
  supplier: string;
  confidence?: number;
  costMicros: number;
  firstSeen: string;
  lastSeen: string;
  views: number;
  pages: { path: string; views: number }[];
}

export interface PersonStats {
  identified: number;
  /** Lookups the audit log shows, by outcome. */
  lookups: number;
  noMatch: number;
  failed: number;
  suppressed: number;
  skipped: number;
  spentMicros: number;
  /** All paid person-level calls divided by identified people, so no-match calls are included. null when nothing was paid for. */
  perIdentificationMicros: number | null;
  bySupplier: { supplier: string; identified: number; costMicros: number }[];
}

export interface PersonView {
  /** The switch, the date and all five conditions. Only then does anything run. */
  active: boolean;
  people: PersonRow[];
  byCompany: Record<string, PersonRow[]>;
  stats: PersonStats;
  quote: PersonQuote;
  suppression: { sha256: number; md5: number; domains: string[]; recent: SuppressionEntry[] };
  audit: AuditEntry[];
  pending: number;
}

const emptyQuote = (capMicros: number): PersonQuote => ({ pending: 0, lines: [], maxMicros: 0, capMicros, capBinds: false });

/** Everything the People, Suppression and Audit pages show. Free: reads the state only. */
export function buildPersonView(state: State, config: RevealConfig): PersonView {
  const p = state.person;
  const capMicros = Math.round(config.personLevel.spendCapUsd * 1_000_000);
  const active = isPersonLevelActive(config);
  const people: PersonRow[] = Object.values(p?.people ?? {})
    .map((r) => {
      const pages = new Map<string, number>();
      for (const v of r.visits) pages.set(v.path, (pages.get(v.path) ?? 0) + 1);
      return {
        id: r.id,
        name: r.name ?? "Name not returned",
        title: r.title,
        company: r.company,
        companyDomain: r.companyDomain,
        linkedinUrl: r.linkedinUrl,
        emailHashShort: r.emailSha256?.slice(0, 12),
        hasStoredEmail: Boolean(r.workEmail),
        supplier: r.supplier,
        confidence: r.confidence,
        costMicros: r.costMicros,
        firstSeen: r.firstSeen,
        lastSeen: r.lastSeen,
        views: r.visits.length,
        pages: [...pages].map(([path, views]) => ({ path, views })).sort((a, b) => b.views - a.views),
      };
    })
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  const byCompany: Record<string, PersonRow[]> = {};
  for (const r of people) if (r.companyDomain) (byCompany[r.companyDomain] ??= []).push(r);

  const audit = p?.audit ?? [];
  const count = (o: string) => audit.filter((a) => a.kind === "lookup" && a.outcome === o).length;
  const bySupplier = new Map<string, { supplier: string; identified: number; costMicros: number }>();
  for (const r of people) {
    const e = bySupplier.get(r.supplier) ?? { supplier: r.supplier, identified: 0, costMicros: 0 };
    e.identified++;
    e.costMicros += r.costMicros;
    bySupplier.set(r.supplier, e);
  }
  // Every paid person-level call counts, including supplier calls that found no one. That is the honest cost of an identification.
  const spent = state.calls.filter((c) => c.job === PERSON_IDENTIFY_JOB || c.job === PERSON_ENRICH_JOB).reduce((n, c) => n + c.costMicros, 0);
  const sup = p?.suppression ?? [];
  return {
    active,
    people,
    byCompany,
    stats: {
      identified: people.length,
      lookups: audit.filter((a) => a.kind === "lookup").length,
      noMatch: count("no_match"),
      failed: count("failed"),
      suppressed: count("suppressed"),
      skipped: audit.filter((a) => a.kind === "skipped").length,
      spentMicros: spent,
      perIdentificationMicros: spent > 0 && people.length > 0 ? Math.round(spent / people.length) : null,
      bySupplier: [...bySupplier.values()].sort((a, b) => b.costMicros - a.costMicros),
    },
    quote: active ? quotePersonRun(state, config, capMicros) : emptyQuote(capMicros),
    suppression: { sha256: sup.filter((e) => e.kind === "sha256").length, md5: sup.filter((e) => e.kind === "md5").length, domains: sup.filter((e) => e.kind === "domain").map((e) => e.value), recent: [...sup].reverse().slice(0, 50) },
    audit: [...audit].reverse().slice(0, 300),
    pending: p?.pending.length ?? 0,
  };
}
