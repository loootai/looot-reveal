"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { saveConfig } from "@/components/saveConfig";
import type { RevealConfig } from "@/lib/config";

export function RetentionClient({ config, demo }: { config: RevealConfig; demo: boolean }) {
  const router = useRouter();
  const [days, setDays] = React.useState(String(config.retentionDays));
  const [raw, setRaw] = React.useState(config.storeRawIp);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const save = async () => {
    setBusy(true);
    const err = await saveConfig({ ...config, retentionDays: Number(days), storeRawIp: raw });
    setMsg(err ? { ok: false, text: err } : { ok: true, text: "Saved to reveal.config.json." });
    setBusy(false);
    if (!err) router.refresh();
  };
  const purge = async () => {
    setBusy(true);
    const r = (await (await fetch("/api/purge", { method: "POST" })).json()) as { visits: number; resolutions: number };
    setMsg({ ok: true, text: `Removed ${r.visits} visits and ${r.resolutions} stored answers past the retention window.` });
    setBusy(false);
    router.refresh();
  };

  return (
    <section aria-labelledby="ret" className="grid max-w-2xl gap-4 rounded-panel border border-line bg-panel p-4">
      <h2 id="ret" className="font-semibold">Retention</h2>
      <Field label="Delete visits and stored answers older than this many days" htmlFor="days">
        <Input id="days" inputMode="numeric" className="num w-28" value={days} onChange={(e) => setDays(e.target.value)} />
      </Field>
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--emerald)]" checked={raw} onChange={(e) => setRaw(e.target.checked)} />
        <span>
          Keep raw IP addresses
          <span className="block text-12 text-mute">Off keeps only a salted hash once an IP has an answer. Turn it on only if you need the addresses.</span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={busy || demo} onClick={save}>Save retention</Button>
        <Button disabled={busy || demo} onClick={purge}>Delete data past retention now</Button>
        {demo && <span className="text-12 text-mute">The demo does not save settings.</span>}
      </div>
      {msg && <p role="status" className={msg.ok ? "rounded-control bg-brand-soft p-2 text-link" : "rounded-control bg-high-soft p-2 text-high"}>{msg.text}</p>}
    </section>
  );
}
