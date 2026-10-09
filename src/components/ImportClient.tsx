"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { usd, usdPrecise } from "@/lib/money";
import type { Quote } from "@/lib/quote";

const SAMPLE = `203.0.113.10 - - [10/Oct/2026:09:12:01 +0000] "GET /pricing HTTP/1.1" 200 5120 "https://www.google.com/" "Mozilla/5.0"
203.0.113.40 - - [10/Oct/2026:09:14:22 +0000] "GET /docs/api HTTP/1.1" 200 8120 "-" "Mozilla/5.0"`;

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

export function ImportClient({ quote, pending, demo, hasToken, capUsd }: { quote: Quote; pending: number; demo: boolean; hasToken: boolean; capUsd: number }) {
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [format, setFormat] = React.useState("auto");
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const canRun = pending > 0 && (hasToken || demo);

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg(await fn());
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <section className="flex flex-col gap-3 rounded-panel border border-line bg-panel p-4" aria-labelledby="add">
        <h2 id="add" className="font-semibold">
          1. Add visits (free)
        </h2>
        <p className="text-mute">Paste a web server access log (combined format), a CSV with an ip column, or JSON lines. Assets, bots and error responses are dropped, and query strings are cut before anything is stored.</p>
        <textarea aria-label="Access log or CSV" value={text} onChange={(e) => setText(e.target.value)} placeholder={SAMPLE} rows={10} className="num w-full rounded-control border border-line-strong bg-panel p-2.5 text-12 placeholder:text-faint focus-visible:border-emerald" />
        <div className="flex flex-wrap items-center gap-2">
          <input type="file" aria-label="Choose a file" className="text-12" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
          <Select aria-label="Format" value={format} onChange={(e) => setFormat(e.target.value)} className="ml-auto w-36">
            <option value="auto">Detect format</option>
            <option value="combined">Access log</option>
            <option value="csv">CSV</option>
            <option value="jsonl">JSON lines</option>
          </Select>
          <Button
            variant="primary"
            disabled={busy || text.trim() === ""}
            onClick={() =>
              act(async () => {
                const r = await post<{ visits: number; newIps: number; format: string }>("/api/import", { text, format });
                setText("");
                return `Added ${r.visits} page views (${r.format}). ${r.newIps} new IPs are waiting for a lookup.`;
              })
            }
          >
            Add visits
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-panel border border-line bg-panel p-4" aria-labelledby="run">
        <h2 id="run" className="font-semibold">
          2. Look up the companies (paid)
        </h2>
        {pending === 0 ? (
          <p className="text-mute">Nothing is waiting. Add visits first, or all IPs already have an answer.</p>
        ) : (
          <>
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
              {quote.lines.map((l) => (
                <React.Fragment key={l.jobId}>
                  <dt>
                    {l.label}
                    <span className="num block text-12 text-mute">
                      {l.calls} x {usdPrecise(l.priceMicros)} · {l.endpointId}
                    </span>
                  </dt>
                  <dd className="num text-right">{usd(l.calls * l.priceMicros)}</dd>
                </React.Fragment>
              ))}
              <dt className="border-t border-line pt-1 font-medium">Most this can cost</dt>
              <dd className="num border-t border-line pt-1 text-right font-medium">{usd(quote.maxMicros)}</dd>
              <dt className="text-mute">Spend cap for the run</dt>
              <dd className="num text-right text-mute">{usd(quote.capMicros)}</dd>
            </dl>
            <p className="text-12 text-mute">
              The company call only runs for networks that are not consumer ISPs, hosting or VPNs, so the real cost is usually lower. {quote.privateIps} private addresses and {quote.cachedIps} answered ones are free. The run stops before any call that would pass the cap.{quote.capBinds ? " The cap is below the worst case, so the run may stop early." : ""}
            </p>
            {!canRun && <p className="text-12 text-high">LOOOT_TOKEN is not set on the server, so the run is disabled. Use the CLI with --dry-run to see the cost.</p>}
            <Button variant="primary" disabled={busy || !canRun} onClick={() => act(async () => {
              const r = await post<{ spentMicros: number; calls: number; notRun: number; pending: number }>("/api/resolve", { capUsd });
              return `Made ${r.calls} calls and spent ${usd(r.spentMicros)}.${r.notRun > 0 ? ` Stopped at the cap with ${r.notRun} not run.` : ""}${r.pending > 0 ? ` ${r.pending} still pending.` : ""}`;
            })}>
              Run for up to {usd(Math.min(quote.maxMicros, quote.capMicros))}
            </Button>
          </>
        )}
        {msg && (
          <p role="status" className="rounded-control bg-brand-soft p-2 text-link">
            {msg}
          </p>
        )}
      </section>
    </div>
  );
}
