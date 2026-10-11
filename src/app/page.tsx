import Link from "next/link";
import { VisitorsClient } from "@/components/VisitorsClient";
import { buttonClass } from "@/components/ui/button";
import { getView } from "@/lib/app";
import { reasonLabel } from "@/lib/format";
import { usd } from "@/lib/money";

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

export default async function VisitorsPage() {
  const v = await getView();
  const { feed } = v;
  const icp = feed.companies.filter((c) => c.icp.matched).length;
  const reasons = Object.entries(feed.excluded.byReason);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-20 font-semibold">Visiting companies</h1>
        <p className="text-mute">Each row is a business network that opened your site, with the pages it viewed.</p>
      </div>
      {v.pendingIps > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-panel border border-line bg-amber-soft p-3 text-amber" role="status">
          <span>
            {v.pendingIps} IPs are waiting to be looked up. Most this costs: {usd(v.quote.maxMicros)}.
          </span>
          <Link href="/import" className={buttonClass("secondary", "sm", "ml-auto")}>
            Review the quote
          </Link>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Companies" value={String(feed.companies.length)} note={`${feed.totalVisits} page views`} />
        <Stat label="ICP matches" value={String(icp)} note={`threshold ${v.config.icp.threshold} of ${v.config.icp.signals.reduce((n, s) => n + s.weight, 0)}`} />
        <Stat label="Not companies" value={String(feed.excluded.count)} note={reasons.map(([r, n]) => `${reasonLabel(r)} ${n}`).join(", ") || "none"} />
        <Stat label="Spent on looot" value={usd(v.spentMicros)} note={`kept ${v.retention.days} days`} />
      </div>
      {feed.companies.length === 0 ? (
        <div className="rounded-panel border border-line bg-panel p-10 text-center">
          <p className="font-medium">No visits yet.</p>
          <p className="mb-4 text-mute">Import an access log or a CSV of IPs, or add the tracking snippet to your site.</p>
          <Link href="/import" className={buttonClass("primary")}>
            Import visits
          </Link>
        </div>
      ) : (
        <VisitorsClient companies={feed.companies} now={v.now} />
      )}
    </div>
  );
}
