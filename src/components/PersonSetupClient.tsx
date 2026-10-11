"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/misc";
import { saveConfig } from "@/components/saveConfig";
import type { RevealConfig } from "@/lib/config";
import { EXAMPLE_HTTP_CONFIG } from "@/lib/person/notice";
import { BLOCKED_COUNTRIES, CONDITION_IDS, PERSON_CONDITIONS } from "@/lib/person/schema";

const Check = ({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; disabled?: boolean }) => (
  <label className="flex items-start gap-2">
    <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--emerald)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    <span>{children}</span>
  </label>
);

export function PersonSetupClient({ config, demo }: { config: RevealConfig; demo: boolean }) {
  const router = useRouter();
  const pl = config.personLevel;
  const [ticked, setTicked] = React.useState<string[]>(pl.acknowledgedConditions);
  const [accept, setAccept] = React.useState(pl.enabled);
  const [regions, setRegions] = React.useState(pl.allowedRegions.join(", "));
  const [consent, setConsent] = React.useState(pl.requireConsent);
  const [days, setDays] = React.useState(String(pl.retentionDays));
  const [auditDays, setAuditDays] = React.useState(String(pl.auditRetentionDays));
  const [cap, setCap] = React.useState(String(pl.spendCapUsd));
  const [storeEmail, setStoreEmail] = React.useState(pl.storeWorkEmail);
  const [known, setKnown] = React.useState(pl.knownVisitor.enabled);
  const [enrich, setEnrich] = React.useState(pl.enrich.enabled);
  const [enrichEndpoint, setEnrichEndpoint] = React.useState(pl.enrich.endpointId);
  const [enrichPrice, setEnrichPrice] = React.useState(String(pl.enrich.priceUsd));
  const [httpOn, setHttpOn] = React.useState(pl.http.enabled);
  const [http, setHttp] = React.useState(JSON.stringify({ ...pl.http, enabled: undefined }, null, 2));
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const allTicked = CONDITION_IDS.every((id) => ticked.includes(id));
  const toggle = (id: string, on: boolean) => setTicked((t) => (on ? [...new Set([...t, id])] : t.filter((x) => x !== id)));

  const save = async (enabled: boolean) => {
    setBusy(true);
    setMsg(null);
    let httpObj: unknown;
    try {
      httpObj = { ...(JSON.parse(http) as object), enabled: httpOn };
    } catch {
      setMsg({ ok: false, text: "The supplier settings are not valid JSON." });
      setBusy(false);
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const next = {
      ...config,
      personLevel: {
        ...pl,
        enabled,
        acknowledgedConditions: ticked,
        acknowledgedTerms: enabled ? (pl.enabled && pl.acknowledgedTerms ? pl.acknowledgedTerms : today) : pl.acknowledgedTerms,
        allowedRegions: regions.split(/[\s,]+/).filter(Boolean),
        requireConsent: consent,
        retentionDays: Number(days),
        auditRetentionDays: Number(auditDays),
        spendCapUsd: Number(cap),
        storeWorkEmail: storeEmail,
        knownVisitor: { enabled: known },
        enrich: { ...pl.enrich, enabled: enrich, endpointId: enrichEndpoint, priceUsd: Number(enrichPrice) },
        http: httpObj,
      },
    };
    const err = await saveConfig(next);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: enabled ? "Saved. Person-level identification is on." : "Saved. Person-level identification is off." });
    setBusy(false);
    if (!err) router.refresh();
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <section className="grid gap-3 rounded-panel border border-line bg-panel p-4" aria-labelledby="cond">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="cond" className="font-semibold">Conditions</h2>
          {pl.enabled ? <Badge tone="brand">On since {pl.acknowledgedTerms}</Badge> : <Badge>Off</Badge>}
        </div>
        <p className="text-12 text-mute">The switch stays locked until you tick every box. The server checks the same rule when it saves, so editing the config file by hand does not skip it.</p>
        {PERSON_CONDITIONS.map((c) => (
          <Check key={c.id} checked={ticked.includes(c.id)} onChange={(on) => toggle(c.id, on)} disabled={demo}>{c.label}</Check>
        ))}
        <Check checked={accept} onChange={setAccept} disabled={demo || !allTicked}>
          <span className="font-medium">I accept these conditions today and turn this feature on at my own responsibility.</span>
        </Check>
      </section>

      <section className="grid gap-4 rounded-panel border border-line bg-panel p-4" aria-labelledby="gates">
        <h2 id="gates" className="font-semibold">Checks that run before any lookup</h2>
        <Field label="Countries allowed" htmlFor="regions" help={`Two-letter codes, separated by commas. The EU, the EEA, the UK and Switzerland (${BLOCKED_COUNTRIES.size} codes) are blocked in code and cannot be added.`}>
          <Input id="regions" value={regions} onChange={(e) => setRegions(e.target.value)} className="num w-60" disabled={demo} />
        </Field>
        <Check checked={consent} onChange={setConsent} disabled={demo}>
          Wait for a consent signal before any lookup
          <span className="block text-12 text-mute">The snippet reads OneTrust, Cookiebot and CookieYes, or window.revealGrantPerson(). Global Privacy Control and Do Not Track always stop a lookup, whatever this says.</span>
        </Check>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Keep people for (days)" htmlFor="pdays"><Input id="pdays" inputMode="numeric" className="num" value={days} onChange={(e) => setDays(e.target.value)} disabled={demo} /></Field>
          <Field label="Keep audit log for (days)" htmlFor="adays"><Input id="adays" inputMode="numeric" className="num" value={auditDays} onChange={(e) => setAuditDays(e.target.value)} disabled={demo} /></Field>
          <Field label="Spend cap per run (USD)" htmlFor="pcap"><Input id="pcap" inputMode="decimal" className="num" value={cap} onChange={(e) => setCap(e.target.value)} disabled={demo} /></Field>
        </div>
        <Check checked={storeEmail} onChange={setStoreEmail} disabled={demo}>
          Keep a work email the supplier returns
          <span className="block text-12 text-mute">Off keeps only its hash. Leave it off unless you need to send the email somewhere.</span>
        </Check>
      </section>

      <section className="grid gap-4 rounded-panel border border-line bg-panel p-4" aria-labelledby="slot">
        <h2 id="slot" className="font-semibold">Where identities come from</h2>
        <p className="text-12 text-mute">No supplier is bundled and looot supplies no person-level visitor identity. You add your own, under your own contract. The steps run in this order and stop at the first identity.</p>
        <Check checked={known} onChange={setKnown} disabled={demo}>
          1. Known visitor (free, no third party)
          <span className="block text-12 text-mute">Your site passes a SHA-256 of an email it already holds, from a login, a form submit or a hashed id in an email link. Later visits with the same first-party id link to that person.</span>
        </Check>
        <Check checked={httpOn} onChange={setHttpOn} disabled={demo}>
          2. HTTP supplier (your contract)
          <span className="block text-12 text-mute">A generic adapter for an identity-resolution API you pay for. Set the URL, the header and the environment variable that holds the key, and map the fields. Edit the JSON below.</span>
        </Check>
        <div className="grid gap-1.5">
          <textarea aria-label="HTTP supplier settings" value={http} onChange={(e) => setHttp(e.target.value)} rows={14} spellCheck={false} disabled={demo} className="num w-full rounded-control border border-line-strong bg-panel p-2.5 text-12 focus-visible:border-emerald" />
          <div>
            <Button size="sm" disabled={demo} onClick={() => setHttp(JSON.stringify({ ...EXAMPLE_HTTP_CONFIG, enabled: undefined }, null, 2))}>Insert the example mapping</Button>
          </div>
        </div>
        <Check checked={enrich} onChange={setEnrich} disabled={demo}>
          3. Enrich a hash through looot (quote first, cap enforced)
          <span className="block text-12 text-mute">When only a hashed email is known, send it to the looot endpoint below to get a name, title, LinkedIn URL and company. People Data Labs person enrich accepts an <span className="num">email_hash</span> parameter in the public looot catalog. The call is billed per match.</span>
        </Check>
        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <Field label="looot endpoint id" htmlFor="eep"><Input id="eep" className="num" value={enrichEndpoint} onChange={(e) => setEnrichEndpoint(e.target.value)} disabled={demo} /></Field>
          <Field label="List price (USD)" htmlFor="eprice"><Input id="eprice" inputMode="decimal" className="num" value={enrichPrice} onChange={(e) => setEnrichPrice(e.target.value)} disabled={demo} /></Field>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={busy || demo || !allTicked || !accept} onClick={() => save(true)}>{pl.enabled ? "Save and keep it on" : "Turn on person-level identification"}</Button>
        <Button disabled={busy || demo} onClick={() => save(false)}>{pl.enabled ? "Turn off and save" : "Save settings, keep it off"}</Button>
        {!allTicked && !demo && <span className="text-12 text-mute">Tick every condition to unlock the switch.</span>}
        {demo && <span className="text-12 text-mute">The demo does not save settings.</span>}
      </div>
      {msg && <p role="status" className={msg.ok ? "rounded-control bg-brand-soft p-2 text-link" : "rounded-control bg-high-soft p-2 text-high"}>{msg.text}</p>}
    </div>
  );
}
