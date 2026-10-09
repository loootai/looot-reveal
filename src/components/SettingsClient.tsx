"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function SettingsClient({ configJson, demo }: { configJson: string; demo: boolean }) {
  const router = useRouter();
  const [text, setText] = React.useState(configJson);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: text });
      const json = (await res.json()) as { error?: string };
      setMsg(res.ok ? { ok: true, text: "Saved to reveal.config.json." } : { ok: false, text: json.error ?? "Could not save." });
      if (res.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "The config is not valid JSON." });
    } finally {
      setBusy(false);
    }
  };
  const purge = async () => {
    setBusy(true);
    const res = await fetch("/api/purge", { method: "POST" });
    const r = (await res.json()) as { visits: number; resolutions: number };
    setMsg({ ok: true, text: `Removed ${r.visits} visits and ${r.resolutions} stored answers past the retention window.` });
    setBusy(false);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <textarea aria-label="Config JSON" value={text} onChange={(e) => setText(e.target.value)} rows={22} spellCheck={false} className="num w-full rounded-control border border-line-strong bg-panel p-2.5 text-12 focus-visible:border-emerald" />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={busy || demo} onClick={save}>
          Save config
        </Button>
        <Button disabled={busy || demo} onClick={purge}>
          Delete data past retention now
        </Button>
        {demo && <span className="text-12 text-mute">The demo does not save settings.</span>}
      </div>
      {msg && (
        <p role="status" className={msg.ok ? "rounded-control bg-brand-soft p-2 text-link" : "rounded-control bg-high-soft p-2 text-high"}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
