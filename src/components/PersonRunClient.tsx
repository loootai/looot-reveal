"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { usd, usdPrecise } from "@/lib/money";
import type { PersonQuote } from "@/lib/person/engine";
import { adminFetch } from "./adminFetch";

/** Quote first, then a run that cannot pass the cap. */
export function PersonRunClient({ quote, demo, hasToken, needsLooot, capUsd }: { quote: PersonQuote; demo: boolean; hasToken: boolean; needsLooot: boolean; capUsd: number }) {
  const router = useRouter();
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const canRun = quote.pending > 0 && (!needsLooot || hasToken || demo);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await adminFetch("/api/person/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ capUsd }) });
      const r = (await res.json()) as { error?: string; spentMicros: number; identified: number; skipped: number; noMatch: number; failed: number; notRun: number; pending: number };
      if (!res.ok) throw new Error(r.error ?? `HTTP ${res.status}`);
      setMsg(`Identified ${r.identified}, no match ${r.noMatch}, refused by a check ${r.skipped}, failed ${r.failed}. Spent ${usd(r.spentMicros)}.${r.notRun > 0 ? ` Stopped at the cap with ${r.notRun} not run.` : ""}${r.pending > 0 ? ` ${r.pending} still queued.` : ""}`);
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="prun" className="flex max-w-xl flex-col gap-3 rounded-panel border border-line bg-panel p-4">
      <h2 id="prun" className="font-semibold">Run the queued visitors (paid)</h2>
      {quote.pending === 0 ? (
        <p className="text-mute">Nothing is queued. A visitor is queued when the snippet sends a person-level event that passes the checks.</p>
      ) : (
        <>
          <p className="text-12 text-mute">{quote.pending} visitors are queued. Each is checked for country, then for a known email hash (free), then sent to your supplier, then enriched through looot if only a hash is known.</p>
          {quote.lines.length > 0 ? (
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
              {quote.lines.map((l) => (
                <React.Fragment key={l.label}>
                  <dt>
                    {l.label}
                    <span className="num block text-12 text-mute">{l.calls} x {usdPrecise(l.priceMicros)}</span>
                  </dt>
                  <dd className="num text-right">{usd(l.calls * l.priceMicros)}</dd>
                </React.Fragment>
              ))}
              <dt className="border-t border-line pt-1 font-medium">Most this can cost</dt>
              <dd className="num border-t border-line pt-1 text-right font-medium">{usd(quote.maxMicros)}</dd>
              <dt className="text-mute">Spend cap for the run</dt>
              <dd className="num text-right text-mute">{usd(quote.capMicros)}</dd>
            </dl>
          ) : (
            <p className="text-12 text-mute">No paid step is on, so this run costs nothing.</p>
          )}
          {quote.capBinds && <p className="text-12 text-amber">The cap is below the worst case, so the run may stop early. Visitors it does not reach stay queued.</p>}
          {!canRun && <p className="text-12 text-high">LOOOT_TOKEN is not set on the server, so the run is disabled.</p>}
          <Button variant="primary" disabled={busy || !canRun} onClick={run}>
            Run for up to {usd(Math.min(quote.maxMicros, quote.capMicros))}
          </Button>
        </>
      )}
      {msg && <p role="status" className="rounded-control bg-brand-soft p-2 text-link">{msg}</p>}
    </section>
  );
}
