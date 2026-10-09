import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, X } from "lucide-react";
import { Badge, Table, Td, Th } from "@/components/ui/misc";
import { getView } from "@/lib/app";
import { ago } from "@/lib/format";
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
        <ArrowLeft className="size-4" /> Visitors
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
