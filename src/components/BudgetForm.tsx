"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { adminFetch } from "./adminFetch";

/** The owner sets the daily and monthly budget in dollars. A run request cannot carry these values. */
export function BudgetForm({ dailyUsd, monthlyUsd, disabled }: { dailyUsd: number; monthlyUsd: number; disabled: boolean }) {
  const router = useRouter();
  const [daily, setDaily] = React.useState(String(dailyUsd));
  const [monthly, setMonthly] = React.useState(String(monthlyUsd));
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await adminFetch("/api/budget", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dailyUsd: Number(daily), monthlyUsd: Number(monthly) }) });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setMsg({ ok: true, text: "Budget saved." });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="flex max-w-xl flex-col gap-3 rounded-panel border border-line bg-panel p-4" aria-label="Change the budget">
      <h2 className="font-semibold">Change the budget</h2>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Daily, dollars" htmlFor="budget-daily">
          <Input id="budget-daily" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} disabled={disabled} className="num" />
        </Field>
        <Field label="Monthly, dollars" htmlFor="budget-monthly">
          <Input id="budget-monthly" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} disabled={disabled} className="num" />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={busy || disabled}>Save budget</Button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-12 text-mute" : "text-12 text-high"}>{msg.text}</p>}
      </div>
      <p className="text-12 text-mute">
        {disabled ? "Demo mode has no budget to change." : "Only the signed-in owner can change this. A run request cannot raise it. The daily budget cannot be above the monthly one. The looot token balance is the final limit, so fund a token with only what you are willing to spend."}
      </p>
    </form>
  );
}
