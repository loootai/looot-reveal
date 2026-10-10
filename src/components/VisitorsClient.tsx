"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Search, TriangleAlert } from "lucide-react";
import { Badge, Segmented, Table, Td, Th } from "@/components/ui/misc";
import { Input } from "@/components/ui/input";
import { ago } from "@/lib/format";
import { usd } from "@/lib/money";
import type { CompanyVisit } from "@/lib/types";

type Filter = "all" | "icp";

export function VisitorsClient({ companies, now }: { companies: CompanyVisit[]; now: number }) {
  const [filter, setFilter] = React.useState<Filter>("all");
  const [q, setQ] = React.useState("");
  const shown = companies.filter((c) => (filter === "all" || c.icp.matched) && (q === "" || `${c.name} ${c.domain}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <section aria-label="Visiting companies" className="rounded-panel border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <Segmented label="Filter" value={filter} onChange={setFilter} options={[{ value: "all", label: `All ${companies.length}` }, { value: "icp", label: `ICP match ${companies.filter((c) => c.icp.matched).length}` }]} />
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <Input aria-label="Search companies" placeholder="Search company or domain" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="p-8 text-center text-mute">No company matches this filter.</p>
      ) : (
        <div className="overflow-x-auto scroll-thin">
          <Table>
            <thead>
              <tr>
                <Th>Company</Th>
                <Th>ICP</Th>
                <Th>Answered by</Th>
                <Th>Pages viewed</Th>
                <Th className="text-right">Visits</Th>
                <Th>Country</Th>
                <Th>Last seen</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.domain} className="hover:bg-hover">
                  <Td className="h-12">
                    <Link href={`/company/${encodeURIComponent(c.domain)}`} className="block font-medium text-ink hover:underline">
                      {c.name}
                    </Link>
                    <span className="num text-12 text-mute">{c.domain}</span>
                    {c.confidence === "low" && (
                      <span className="mt-0.5 flex flex-wrap items-center gap-1 text-12 text-amber">
                        <Badge tone="amber"><TriangleAlert className="size-3" /> Low confidence</Badge>
                        also named: {c.alternatives.map((a) => a.name ?? a.domain).join(", ")}
                      </span>
                    )}
                    {c.confidence === "medium" && <span className="block text-12 text-mute">Network owner only</span>}
                  </Td>
                  <Td>
                    {c.icp.matched ? (
                      <Badge tone="brand">
                        <Check className="size-3" /> Match {c.icp.score}/{c.icp.maxScore}
                      </Badge>
                    ) : (
                      <Badge>
                        {c.icp.score}/{c.icp.maxScore}
                      </Badge>
                    )}
                  </Td>
                  <Td className="num whitespace-nowrap text-12">
                    {c.answeredBy.map((a) => (
                      <div key={a.provider}>
                        {a.provider} <span className="text-mute">{usd(a.costMicros)}</span>
                      </div>
                    ))}
                  </Td>
                  <Td className="max-w-72">
                    <div className="flex flex-wrap gap-1">
                      {c.pages.slice(0, 3).map((p) => (
                        <span key={p.path} className="num rounded bg-hover px-1.5 text-12 text-ink">
                          {p.path}
                          {p.views > 1 && <span className="text-mute"> x{p.views}</span>}
                        </span>
                      ))}
                      {c.pages.length > 3 && <span className="text-12 text-mute">+{c.pages.length - 3}</span>}
                    </div>
                  </Td>
                  <Td className="num text-right">{c.visits}</Td>
                  <Td>{c.country ?? "-"}</Td>
                  <Td className="whitespace-nowrap text-mute" title={c.lastSeen}>
                    {ago(c.lastSeen, now)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      <p className="border-t border-line px-3 py-2 text-12 text-mute">Spent on looot calls for these rows: {usd(companies.reduce((n, c) => n + c.costMicros, 0))}.</p>
    </section>
  );
}
