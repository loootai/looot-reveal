"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveConfig } from "@/components/saveConfig";
import type { RevealConfig } from "@/lib/config";

const describe = (s: RevealConfig["icp"]["signals"][number]): string => {
  if (s.kind === "text") return `${s.field} contains ${s.anyOf.join(", ")}`;
  if (s.kind === "employees") return `${s.min} to ${s.max ?? "any"} employees`;
  return `viewed ${s.paths.join(", ")}`;
};

export function IcpClient({ config, demo }: { config: RevealConfig; demo: boolean }) {
  const router = useRouter();
  const [threshold, setThreshold] = React.useState(String(config.icp.threshold));
  const [weights, setWeights] = React.useState<Record<string, string>>(Object.fromEntries(config.icp.signals.map((s) => [s.id, String(s.weight)])));
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const total = config.icp.signals.reduce((n, s) => n + (Number(weights[s.id]) || 0), 0);

  const save = async () => {
    setBusy(true);
    const next = { ...config, icp: { threshold: Number(threshold), signals: config.icp.signals.map((s) => ({ ...s, weight: Number(weights[s.id]) || 0 })) } };
    const err = await saveConfig(next);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: "Saved to reveal.config.json." });
    setBusy(false);
    if (!err) router.refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="signals" className="rounded-panel border border-line bg-panel">
        <div className="border-b border-line p-3">
          <h2 id="signals" className="font-semibold">Signals and weights</h2>
          <p className="text-12 text-mute">A company matches when its matched weights add up to the threshold. Each check is shown with its value and source on the company page. To add or change a check, edit the config file.</p>
        </div>
        <ul className="divide-y divide-line">
          {config.icp.signals.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{s.label}</div>
                <div className="num text-12 text-mute">{s.id} · {describe(s)}</div>
              </div>
              <label className="flex items-center gap-2 text-12">
                <span className="text-mute">Weight</span>
                <Input aria-label={`${s.label} weight`} inputMode="numeric" className="num w-20" value={weights[s.id]} onChange={(e) => setWeights({ ...weights, [s.id]: e.target.value })} />
              </label>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-wrap items-center gap-3 rounded-panel border border-line bg-panel p-4">
        <label className="flex items-center gap-2">
          <span className="font-medium">Threshold</span>
          <Input aria-label="ICP threshold" inputMode="numeric" className="num w-20" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        </label>
        <span className="text-mute">of {total} possible.</span>
      </section>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={busy || demo} onClick={save}>Save ICP</Button>
        {demo && <span className="text-12 text-mute">The demo does not save settings.</span>}
      </div>
      {msg && <p role="status" className={msg.ok ? "rounded-control bg-brand-soft p-2 text-link" : "rounded-control bg-high-soft p-2 text-high"}>{msg.text}</p>}
    </div>
  );
}
