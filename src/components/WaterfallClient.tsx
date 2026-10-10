"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/misc";
import { saveConfig } from "@/components/saveConfig";
import type { ProviderConfig, RevealConfig } from "@/lib/config";
import { usd, usdPrecise } from "@/lib/money";
import type { Quote } from "@/lib/quote";

const TRUST: Record<ProviderConfig["trust"], string> = {
  asn_owner: "Network owner only. Never stops the waterfall.",
  network_type: "Says if the network is a business, ISP or host.",
  company: "Resolves the IP to a company itself.",
};

export function WaterfallClient({ config, quote, demo }: { config: RevealConfig; quote: Quote; demo: boolean }) {
  const router = useRouter();
  const [providers, setProviders] = React.useState<ProviderConfig[]>(config.waterfall.providers);
  const [crossCheck, setCrossCheck] = React.useState(config.waterfall.crossCheck);
  const [cacheDays, setCacheDays] = React.useState(String(config.waterfall.cacheDays));
  const [cap, setCap] = React.useState(String(config.spendCapUsd));
  const [skip, setSkip] = React.useState(config.waterfall.skipCidrs.join("\n"));
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const move = (i: number, d: -1 | 1) => setProviders((ps) => {
    const next = [...ps];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    return next;
  });
  const patch = (i: number, p: Partial<ProviderConfig>) => setProviders((ps) => ps.map((x, n) => (n === i ? { ...x, ...p } : x)));

  const worst = providers.filter((p) => p.enabled).reduce((n, p) => n + Math.round(p.priceUsd * 1_000_000), 0);
  const fresh = quote.lines[0]?.calls ?? 0;

  const save = async () => {
    setBusy(true);
    const next = { ...config, spendCapUsd: Number(cap), waterfall: { providers, crossCheck, cacheDays: Number(cacheDays), skipCidrs: skip.split(/\s+/).filter(Boolean) } };
    const err = await saveConfig(next);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: "Saved to reveal.config.json." });
    setBusy(false);
    if (!err) router.refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="order" className="rounded-panel border border-line bg-panel">
        <div className="border-b border-line p-3">
          <h2 id="order" className="font-semibold">Providers, in call order</h2>
          <p className="text-12 text-mute">Each new IP goes down this list. The walk stops at the first confident company match, and at the first ISP, mobile, hosting or VPN verdict, so nothing more is spent on that address.</p>
        </div>
        <ol className="divide-y divide-line">
          {providers.map((p, i) => (
            <li key={p.id} className="flex flex-col gap-2 p-3 md:grid md:grid-cols-[auto_1fr_auto_auto] md:items-center md:gap-x-3">
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" aria-label={`Move ${p.label} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp />
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Move ${p.label} down`} disabled={i === providers.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown />
                </Button>
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="num text-12 text-mute">{i + 1}.</span>
                  <span className="font-medium">{p.label}</span>
                  {!p.enabled && <Badge>Off</Badge>}
                </div>
                <div className="num text-12 text-mute">{p.endpointId} · {TRUST[p.trust]}</div>
              </div>
              <label className="flex items-center gap-2 text-12">
                <span className="text-mute">Price per call</span>
                <Input aria-label={`${p.label} price per call in dollars`} inputMode="decimal" className="num w-24" value={String(p.priceUsd)} onChange={(e) => patch(i, { priceUsd: Number(e.target.value) || 0 })} />
              </label>
              <label className="flex min-h-11 items-center gap-2 text-13 md:min-h-8">
                <input type="checkbox" className="size-4 accent-[var(--emerald)]" checked={p.enabled} onChange={(e) => patch(i, { enabled: e.target.checked })} />
                Use
              </label>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="quote" className="rounded-panel border border-line bg-panel p-4">
        <h2 id="quote" className="font-semibold">Worst case for the whole waterfall</h2>
        <p className="mb-2 text-mute">Every enabled provider called for every new IP, then one company enrichment per IP. Today {fresh} IPs are waiting.</p>
        <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-4 gap-y-1">
          <dt>Lookups per IP, worst case</dt>
          <dd className="num text-right">{usdPrecise(worst)}</dd>
          <dt>Waiting now (saved settings)</dt>
          <dd className="num text-right">{usd(quote.maxMicros)}</dd>
          <dt className="text-mute">Spend cap for a run</dt>
          <dd className="num text-right text-mute">{usd(quote.capMicros)}</dd>
        </dl>
        <p className="mt-2 text-12 text-mute">Most addresses cost less: a consumer ISP stops at the first provider that names it, and a business stops at the first confident match. A run never starts a call that would pass the cap.</p>
      </section>

      <section aria-labelledby="opts" className="grid gap-4 rounded-panel border border-line bg-panel p-4 md:grid-cols-2">
        <h2 id="opts" className="font-semibold md:col-span-2">Rules</h2>
        <Field label="Spend cap per run, in dollars" htmlFor="cap">
          <Input id="cap" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} className="num" />
        </Field>
        <Field label="Keep an answer per IP for this many days" htmlFor="cache" help="After that the IP is looked up again. 0 looks every IP up on every run.">
          <Input id="cache" inputMode="numeric" value={cacheDays} onChange={(e) => setCacheDays(e.target.value)} className="num" />
        </Field>
        <label className="flex items-start gap-2 md:col-span-2">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--emerald)]" checked={crossCheck} onChange={(e) => setCrossCheck(e.target.checked)} />
          <span>
            Ask a second company-level provider after a confident match
            <span className="block text-12 text-mute">Costs the second provider&apos;s price on every IP. If the two name different companies, the row shows both and is marked low confidence.</span>
          </span>
        </label>
        <Field label="Never look up these IPv4 ranges (one CIDR per line)" htmlFor="skip" className="md:col-span-2">
          <textarea id="skip" rows={3} value={skip} onChange={(e) => setSkip(e.target.value)} placeholder="203.0.113.0/24" className="num w-full rounded-control border border-line-strong bg-panel p-2.5 text-12 focus-visible:border-emerald" />
        </Field>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={busy || demo} onClick={save}>Save waterfall</Button>
        {demo && <span className="text-12 text-mute">The demo does not save settings.</span>}
      </div>
      {msg && <p role="status" className={msg.ok ? "rounded-control bg-brand-soft p-2 text-link" : "rounded-control bg-high-soft p-2 text-high"}>{msg.text}</p>}
    </div>
  );
}
