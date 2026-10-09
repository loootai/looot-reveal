import type { Feed } from "@/lib/feed";
import { usd, usdPrecise } from "@/lib/money";
import type { Quote } from "@/lib/quote";
import type { CompanyVisit } from "@/lib/types";

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The quote as plain text, for --dry-run and the start of a run. */
export function renderQuote(q: Quote, priceNote: string): string {
  const lines = [
    `${q.uniqueIps} unique IPs: ${q.privateIps} private (skipped, free), ${q.cachedIps} already answered (free), ${q.uniqueIps - q.privateIps - q.cachedIps} to look up.`,
    ...q.lines.map((l) => `  ${l.label}: ${l.calls} x ${usdPrecise(l.priceMicros)} = ${usd(l.calls * l.priceMicros)}  [${l.jobId}, ${l.endpointId}]`),
    `Most this run can cost: ${usd(q.maxMicros)}. Spend cap: ${usd(q.capMicros)}${q.capBinds ? " (the run will stop at the cap)" : ""}.`,
    priceNote,
  ];
  return lines.join("\n");
}

/** One CSV row per visiting company. */
export function renderCsv(companies: CompanyVisit[]): string {
  const q = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
  const head = ["company", "domain", "country", "icp_match", "icp_score", "icp_max", "visits", "unique_ips", "first_seen", "last_seen", "pages", "cost_usd"];
  const rows = companies.map((c) => [c.name, c.domain, c.country ?? "", c.icp.matched ? "yes" : "no", c.icp.score, c.icp.maxScore, c.visits, c.uniqueIps, c.firstSeen, c.lastSeen, c.pages.map((p) => `${p.path} (${p.views})`).join("; "), (c.costMicros / 1_000_000).toFixed(4)]);
  return [head, ...rows].map((r) => r.map(q).join(",")).join("\n") + "\n";
}

/** A markdown report: summary, the visiting companies, and the signals behind each ICP flag. */
export function renderMarkdown(feed: Feed, opts: { title: string; spentMicros: number }): string {
  const matched = feed.companies.filter((c) => c.icp.matched);
  const out: string[] = [`# ${opts.title}`, ""];
  out.push(`${feed.companies.length} visiting companies from ${feed.totalVisits} page views. ${matched.length} match the ICP. ${feed.excluded.count} views were from networks that are not companies (${Object.entries(feed.excluded.byReason).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}). ${feed.pendingVisits} views are still unresolved.`, "", `Spent on looot calls: ${usd(opts.spentMicros)}.`, "");
  out.push("| Company | Country | ICP | Visits | Last seen | Pages |", "|---|---|---|---|---|---|");
  for (const c of feed.companies) out.push(`| ${cell(c.name)} (${c.domain}) | ${c.country ?? ""} | ${c.icp.matched ? "match" : "no"} ${c.icp.score}/${c.icp.maxScore} | ${c.visits} | ${c.lastSeen.slice(0, 10)} | ${cell(c.pages.slice(0, 4).map((p) => `${p.path} x${p.views}`).join(", "))} |`);
  if (matched.length > 0) {
    out.push("", "## Why these match", "");
    for (const c of matched) {
      out.push(`### ${c.name}`, "", "| Signal | Matched | Value | Weight | Source | Call cost |", "|---|---|---|---|---|---|");
      for (const s of c.icp.signals) out.push(`| ${cell(s.label)} | ${s.matched ? "yes" : "no"} | ${cell(s.value)} | ${s.weight} | ${cell(s.provider)} | ${usdPrecise(s.costMicros)} |`);
      out.push("");
    }
  }
  return out.join("\n") + "\n";
}
