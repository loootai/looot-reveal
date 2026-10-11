import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/guard";
import { Table, Td, Th } from "@/components/ui/misc";
import { getView } from "@/lib/app";
import { ago } from "@/lib/format";
import { usd, usdPrecise } from "@/lib/money";
import { PRICES_AS_OF } from "@/lib/sources";

export const metadata: Metadata = { title: "Costs" };
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

export default async function CostsPage() {
  await requireAdminPage();
  const v = await getView();
  const { byProvider, recent } = v.costs;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-20 font-semibold">Costs</h1>
        <p className="text-mute">Every looot call the state file remembers, what it cost, and what the next run could cost. List prices as of {PRICES_AS_OF}; the real charge is read from each run. Rows for person.identify are calls to your own identity supplier, counted at the price in your config. They are not looot calls and are not in the total.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Spent in total" value={usd(v.spentMicros)} note={`kept ${v.retention.days} days`} />
        <Stat label="Spend cap per run" value={usd(v.quote.capMicros)} />
        <Stat label="Waiting to run" value={`${v.pendingIps} IPs`} note={`most ${usd(v.quote.maxMicros)}`} />
        <Stat label="Providers on" value={String(v.quote.order.length)} note={v.quote.order.map((p) => p.id).join(", ") || "none"} />
      </div>
      <section aria-labelledby="by" className="rounded-panel border border-line bg-panel">
        <h2 id="by" className="border-b border-line p-3 font-semibold">By provider</h2>
        {byProvider.length === 0 ? (
          <p className="p-6 text-center text-mute">No calls yet.</p>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <Table>
              <thead>
                <tr><Th>Provider</Th><Th>Job</Th><Th className="text-right">Calls</Th><Th className="text-right">Not completed</Th><Th className="text-right">Spent</Th></tr>
              </thead>
              <tbody>
                {byProvider.map((r) => (
                  <tr key={`${r.job}|${r.provider}`}>
                    <Td className="num">{r.provider}</Td>
                    <Td className="num">{r.job}</Td>
                    <Td className="num text-right">{r.calls}</Td>
                    <Td className="num text-right">{r.failed}</Td>
                    <Td className="num text-right">{usdPrecise(r.costMicros)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </section>
      <section aria-labelledby="rec" className="rounded-panel border border-line bg-panel">
        <h2 id="rec" className="border-b border-line p-3 font-semibold">Latest calls</h2>
        {recent.length === 0 ? (
          <p className="p-6 text-center text-mute">Nothing yet.</p>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <Table>
              <thead>
                <tr><Th>When</Th><Th>Provider</Th><Th>Job</Th><Th>Status</Th><Th className="text-right">Cost</Th></tr>
              </thead>
              <tbody>
                {recent.map((c, i) => (
                  <tr key={`${c.at}-${i}`}>
                    <Td className="whitespace-nowrap text-mute">{ago(c.at, v.now)}</Td>
                    <Td className="num">{c.providerId}</Td>
                    <Td className="num">{c.job}</Td>
                    <Td>{c.status}</Td>
                    <Td className="num text-right">{usdPrecise(c.costMicros)}</Td>
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
