import type { RevealConfig } from "./config";
import type { CompanyEntry } from "./engine";
import { scoreIcp } from "./icp";
import type { CompanyVisit, Excluded, Resolution, StoredVisit } from "./types";

export interface Feed {
  companies: CompanyVisit[];
  excluded: Excluded;
  pendingVisits: number;
  totalVisits: number;
}

/**
 * Groups stored visits by the company their IP resolved to. `resolutions` is keyed the same way
 * as StoredVisit.ipKey (a hash, or the raw IP when storeRawIp is on).
 */
export function buildFeed(visits: StoredVisit[], resolutions: Record<string, Resolution>, companies: Record<string, CompanyEntry>, config: RevealConfig): Feed {
  type Acc = { domain: string; name: string; ipKeys: Set<string>; visits: StoredVisit[]; res: Resolution };
  const byDomain = new Map<string, Acc>();
  const excluded: Excluded = { count: 0, byReason: {} };
  let pendingVisits = 0;
  const ignore = config.ignorePaths;
  const counted = visits.filter((v) => !ignore.some((p) => v.path === p || v.path.startsWith(`${p}/`)));

  for (const v of counted) {
    const r = resolutions[v.ipKey];
    if (!r || r.status === "pending" || r.status === "failed") {
      pendingVisits++;
      continue;
    }
    if (r.status === "excluded") {
      excluded.count++;
      if (r.reason) excluded.byReason[r.reason] = (excluded.byReason[r.reason] ?? 0) + 1;
      continue;
    }
    const domain = r.domain ?? "unknown";
    const acc = byDomain.get(domain) ?? { domain, name: r.name ?? domain, ipKeys: new Set(), visits: [], res: r };
    acc.ipKeys.add(v.ipKey);
    acc.visits.push(v);
    byDomain.set(domain, acc);
  }

  const out: CompanyVisit[] = [...byDomain.values()].map((a) => {
    const entry = companies[a.domain];
    const profile = entry?.status === "done" ? entry.profile : undefined;
    const pageCounts = new Map<string, number>();
    for (const v of a.visits) pageCounts.set(v.path, (pageCounts.get(v.path) ?? 0) + 1);
    const times = a.visits.map((v) => v.ts).sort();
    const icp = scoreIcp(config, {
      profile,
      profileProvider: entry?.provider ?? "company.enrich",
      profileCostMicros: entry?.costMicros ?? 0,
      info: a.res.info,
      lookupProvider: a.res.lookupProvider ?? "ip.lookup",
      lookupCostMicros: a.res.costMicros,
      paths: a.visits.map((v) => v.path),
    });
    const lookupCost = [...a.ipKeys].reduce((n, k) => n + (resolutions[k]?.costMicros ?? 0), 0);
    return {
      domain: a.domain,
      name: profile?.name ?? a.name,
      profile,
      country: profile?.country ?? a.res.info?.country,
      visits: a.visits.length,
      uniqueIps: a.ipKeys.size,
      firstSeen: times[0],
      lastSeen: times[times.length - 1],
      pages: [...pageCounts].map(([path, views]) => ({ path, views })).sort((x, y) => y.views - x.views),
      icp,
      costMicros: lookupCost + (entry?.costMicros ?? 0),
    };
  });
  out.sort((x, y) => Number(y.icp.matched) - Number(x.icp.matched) || y.lastSeen.localeCompare(x.lastSeen));
  return { companies: out, excluded, pendingVisits, totalVisits: counted.length };
}
