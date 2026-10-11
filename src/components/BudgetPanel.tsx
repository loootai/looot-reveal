import type { BudgetStatus, PeriodStatus } from "@/lib/budget";
import { usd } from "@/lib/money";

function Period({ label, p }: { label: string; p: PeriodStatus }) {
  const ratio = p.limitMicros > 0 ? Math.min(1, (p.usedMicros + p.reservedMicros) / p.limitMicros) : 0;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-medium">{label}</h3>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Budget", usd(p.limitMicros)],
          ["Used", usd(p.usedMicros)],
          ["Reserved", usd(p.reservedMicros)],
          ["Remaining", usd(p.remainingMicros)],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-12 text-mute">{k}</dt>
            <dd className="num text-20 font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="h-1.5 overflow-hidden rounded-full bg-hover" role="meter" aria-label={`${label} budget used and reserved`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
        <div className="h-full bg-brand" style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

/** Used, reserved and remaining against the daily and monthly budget. */
export function BudgetPanel({ status }: { status: BudgetStatus }) {
  return (
    <section aria-label="Budget" className="flex flex-col gap-4 rounded-panel border border-line bg-panel p-4">
      <h2 className="font-semibold">Budget</h2>
      <Period label="Today (UTC)" p={status.day} />
      <Period label="This month (UTC)" p={status.month} />
      <p className="text-12 text-mute">
        Reserved is money held for calls that are running or whose result has not come back. It counts against the budget until the call ends, then becomes used at the real cost or goes back if the call failed.
        {status.isDefault && " These are the default limits. The owner can change them below."}
        {status.remainingMicros <= 0 && " The budget is reached: paid runs are refused until the period rolls over or the owner raises it."}
      </p>
    </section>
  );
}
