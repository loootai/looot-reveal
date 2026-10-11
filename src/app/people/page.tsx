import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/guard";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { PersonRunClient } from "@/components/PersonRunClient";
import { SampleBanner } from "@/components/SampleBanner";
import { buttonClass } from "@/components/ui/button";
import { Badge, Table, Td, Th } from "@/components/ui/misc";
import { getView } from "@/lib/app";
import { ago } from "@/lib/format";
import { usd } from "@/lib/money";

export const metadata: Metadata = { title: "People" };
export const dynamic = "force-dynamic";

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-panel border border-line bg-panel p-3">
      <div className="text-12 text-mute">{label}</div>
      <div className="num text-20 font-semibold">{value}</div>
      {note && <div className="text-12 text-mute">{note}</div>}
    </div>
  );
}

const href = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

export default async function PeoplePage() {
  await requireAdminPage();
  const v = await getView();
  const pv = v.person;
  const known = new Set(v.feed.companies.map((c) => c.domain));
  if (!pv.active) {
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        <h1 className="text-20 font-semibold">People</h1>
        <div className="rounded-panel border border-line bg-panel p-6">
          <p className="font-medium">Person-level identification is off.</p>
          <p className="mb-4 text-mute">The default is company-level only. Nothing on this page is collected, looked up or stored while it is off. Turning it on takes a setup page that explains the legal conditions and needs each one ticked.</p>
          <Link href="/person-setup" className={buttonClass("primary")}>Read the conditions</Link>
        </div>
      </div>
    );
  }
  const s = pv.stats;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-20 font-semibold">People</h1>
        <p className="text-mute">US visitors your own supplier or your own forms identified. Company-level stays the main view; open a company to see its people.</p>
      </div>
      {v.demo && <SampleBanner />}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="People identified" value={String(s.identified)} note={`kept ${v.config.personLevel.retentionDays} days`} />
        <Stat label="Cost per identification" value={s.perIdentificationMicros === null ? "none yet" : usd(s.perIdentificationMicros)} note={`${usd(s.spentMicros)} spent in total`} />
        <Stat label="Lookups tried" value={String(s.lookups)} note={`${s.noMatch} no match, ${s.failed} failed, ${s.suppressed} suppressed`} />
        <Stat label="Refused by a check" value={String(s.skipped)} note="GPC, DNT, consent, region" />
      </div>
      <PersonRunClient quote={pv.quote} demo={v.demo} hasToken={v.hasToken} needsLooot={v.config.personLevel.enrich.enabled} capUsd={v.config.personLevel.spendCapUsd} />
      <section aria-labelledby="ppl" className="rounded-panel border border-line bg-panel">
        <h2 id="ppl" className="border-b border-line p-3 font-semibold">Identified people</h2>
        {pv.people.length === 0 ? (
          <p className="p-8 text-center text-mute">No one yet.</p>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <Table>
              <thead>
                <tr>
                  <Th>Person</Th>
                  <Th>Company</Th>
                  <Th>Supplied by</Th>
                  <Th className="text-right">Confidence</Th>
                  <Th>Pages</Th>
                  <Th>Last seen</Th>
                  <Th className="text-right">Cost</Th>
                </tr>
              </thead>
              <tbody>
                {pv.people.map((p) => (
                  <tr key={p.id} className="hover:bg-hover">
                    <Td className="h-12">
                      <span className="flex items-center gap-1.5 whitespace-nowrap font-medium">
                        {p.name}
                        {v.demo && <Badge tone="amber">Sample</Badge>}
                      </span>
                      <span className="whitespace-nowrap text-12 text-mute">{p.title ?? "Title not returned"}</span>
                      {p.linkedinUrl && (
                        <a href={href(p.linkedinUrl)} target="_blank" rel="noreferrer noopener" className="ml-2 inline-flex items-center gap-0.5 text-12 text-link hover:underline">
                          LinkedIn <ExternalLink className="size-3" />
                        </a>
                      )}
                    </Td>
                    <Td>
                      {p.companyDomain && known.has(p.companyDomain) ? (
                        <Link href={`/company/${encodeURIComponent(p.companyDomain)}`} className="font-medium hover:underline">{p.company ?? p.companyDomain}</Link>
                      ) : (
                        <span>{p.company ?? "Not returned"}</span>
                      )}
                      {p.companyDomain && <span className="num block text-12 text-mute">{p.companyDomain}</span>}
                    </Td>
                    <Td className="num max-w-36 truncate" title={p.supplier}>{p.supplier}</Td>
                    <Td className="num text-right">{p.confidence === undefined ? "n/a" : `${Math.round(p.confidence * 100)}%`}</Td>
                    <Td className="num max-w-40 truncate" title={p.pages.map((g) => `${g.path} x${g.views}`).join(", ")}>{p.pages.slice(0, 3).map((g) => g.path).join(", ") || "none"}</Td>
                    <Td className="whitespace-nowrap">{ago(p.lastSeen, v.now)}</Td>
                    <Td className="num text-right">{usd(p.costMicros)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        <p className="border-t border-line px-3 py-2 text-12 text-mute">Emails are stored as hashes. A supplier work email is kept only when storeWorkEmail is on. Opt-out and suppression are on the Suppression page.</p>
      </section>
    </div>
  );
}
