import type { Metadata } from "next";
import { SampleBanner } from "@/components/SampleBanner";
import { Badge, Table, Td, Th } from "@/components/ui/misc";
import { getView } from "@/lib/app";
import { usd } from "@/lib/money";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

const TONE = { lookup: "brand", skipped: "amber", optout: "neutral", delete: "neutral", suppress_import: "neutral" } as const;

export default async function AuditPage() {
  const v = await getView();
  const { audit } = v.person;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-20 font-semibold">Audit log</h1>
        <p className="max-w-3xl text-mute">One row for every person-level lookup, and one for every visit a check refused. Each row says when, which supplier, why it was allowed or refused, and what it cost. The log holds no names, emails, addresses or visitor ids. It is kept {v.config.personLevel.auditRetentionDays} days.</p>
      </div>
      {v.demo && <SampleBanner />}
      <section aria-label="Audit log" className="rounded-panel border border-line bg-panel">
        {audit.length === 0 ? (
          <p className="p-8 text-center text-mute">{v.person.active ? "Nothing has been checked yet." : "Person-level identification is off, so nothing is logged."}</p>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <Table>
              <thead>
                <tr>
                  <Th>When (UTC)</Th>
                  <Th>Event and outcome</Th>
                  <Th>Supplier</Th>
                  <Th>Country</Th>
                  <Th>Why</Th>
                  <Th className="text-right">Cost</Th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a, i) => (
                  <tr key={`${a.at}-${i}`}>
                    <Td className="num whitespace-nowrap">{a.at.slice(0, 16).replace("T", " ")}</Td>
                    <Td>
                      <Badge tone={TONE[a.kind]}>{a.kind.replace("_", " ")}</Badge>
                      <span className="num ml-1.5">{a.outcome}</span>
                    </Td>
                    <Td className="num max-w-32 truncate" title={a.supplier}>{a.supplier}</Td>
                    <Td className="num">{a.country ?? "unknown"}</Td>
                    <Td className="min-w-60 max-w-sm whitespace-normal text-12 text-mute">{a.why}</Td>
                    <Td className="num text-right">{usd(a.costMicros)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
