import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, TriangleAlert, X } from "lucide-react";
import { Badge, Table, Td, Th } from "@/components/ui/misc";
import { getView } from "@/lib/app";
import { ago, reasonLabel } from "@/lib/format";
import { usd, usdPrecise } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function CompanyPage({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  const v = await getView();
  const c = v.feed.companies.find((x) => x.domain === decodeURIComponent(domain));
  if (!c) notFound();
  const p = c.profile;
  return (
    <div className="flex flex-col gap-4">
      <Link href="/" className="flex w-fit items-center gap-1 text-link hover:underline">
        <ArrowLeft className="size-4" /> Feed
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-20 font-semibold">{c.name}</h1>
        {c.icp.matched ? <Badge tone="brand">ICP match {c.icp.score}/{c.icp.maxScore}</Badge> : <Badge>Not a match {c.icp.score}/{c.icp.maxScore}</Badge>}
      </div>
      <p className="text-mute">
        <span className="num">{c.domain}</span> · {c.visits} views from {c.uniqueIps} network address{c.uniqueIps === 1 ? "" : "es"} · first seen {ago(c.firstSeen)}, last seen {ago(c.lastSeen)}
        {c.country ? ` · ${c.country}` : ""}
      </p>
      {p?.description && <p className="max-w-2xl">{p.description}</p>}
      {c.confidence === "low" && (
        <div role="note" className="flex max-w-2xl items-start gap-2 rounded-panel border border-line bg-amber-soft p-3 text-amber">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            Low confidence. The providers named different companies for this network. Used: {c.name} ({c.domain}). Also named:{" "}
            {c.alternatives.map((a) => `${a.name ?? a.domain} (${a.domain}) by ${a.provider}`).join("; ")}.
          </span>
        </div>
      )}

      <section className="rounded-panel border border-line bg-panel" aria-labelledby="why">
        <div className="border-b border-line p-3">
          <h2 id="why" className="font-semibold">
            Why {c.icp.matched ? "it matches" : "it does not match"}
          </h2>
          <p className="text-12 text-mute">Matched weights add up to {c.icp.score}. The threshold is {c.icp.threshold}. Edit weights in reveal.config.json.</p>
        </div>
        <div className="overflow-x-auto scroll-thin">
          <Table>
            <thead>
              <tr>
                <Th>Signal</Th>
                <Th>Result</Th>
                <Th>Value seen</Th>
                <Th className="text-right">Weight</Th>
                <Th>Supplied by</Th>
                <Th className="text-right">Call cost</Th>
              </tr>
            </thead>
            <tbody>
              {c.icp.signals.map((s) => (
                <tr key={s.id}>
                  <Td>{s.label}</Td>
                  <Td>{s.matched ? <Check className="size-4 text-emerald" aria-label="Matched" /> : <X className="size-4 text-faint" aria-label="Not matched" />}</Td>
                  <Td className="num max-w-64 truncate" title={s.value}>
                    {s.value}
                  </Td>
                  <Td className="num text-right">{s.weight}</Td>
                  <Td className="num">{s.provider}</Td>
                  <Td className="num text-right">{usdPrecise(s.costMicros)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <p className="border-t border-line px-3 py-2 text-12 text-mute">A call that fed several signals shows its full cost on each row. Total spent on this company: {usd(c.costMicros)}.</p>
      </section>

      <section className="rounded-panel border border-line bg-panel" aria-labelledby="how">
        <div className="border-b border-line p-3">
          <h2 id="how" className="font-semibold">How each address was resolved</h2>
          <p className="text-12 text-mute">Providers are asked in waterfall order. The address itself is not shown.</p>
        </div>
        <ul className="divide-y divide-line">
          {c.lookups.map((l, n) => (
            <li key={n} className="p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Address {n + 1}</span>
                <Badge tone={l.confidence === "high" ? "brand" : "amber"}>{l.confidence} confidence</Badge>
                <span className="num text-12 text-mute">answered by {l.provider}, {usdPrecise(l.costMicros)}</span>
              </div>
              <ol className="mt-1 text-12 text-mute">
                {l.answers.map((a) => (
                  <li key={a.provider} className="num">
                    {a.provider}: {a.outcome}
                    {a.reason ? ` (${reasonLabel(a.reason)})` : ""}
                    {a.name ? `, ${a.name}` : ""}
                    {a.domain ? ` (${a.domain})` : ""} · {usdPrecise(a.costMicros)}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-panel border border-line bg-panel" aria-labelledby="pages">
        <h2 id="pages" className="border-b border-line p-3 font-semibold">
          Pages viewed
        </h2>
        <Table>
          <thead>
            <tr>
              <Th>Path</Th>
              <Th className="text-right">Views</Th>
            </tr>
          </thead>
          <tbody>
            {c.pages.map((pg) => (
              <tr key={pg.path}>
                <Td className="num">{pg.path}</Td>
                <Td className="num text-right">{pg.views}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
      {p && (
        <p className="text-12 text-mute">
          Profile: {p.industry ?? "industry unknown"}, {p.employees ? `${p.employees} employees` : "headcount unknown"}.
        </p>
      )}
    </div>
  );
}
