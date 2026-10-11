"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

/** The public form. A visitor types an email; the server stores only its hashes. */
export function OptOutClient() {
  const [email, setEmail] = React.useState("");
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/optout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const json = (await res.json()) as { error?: string };
      setMsg(res.ok ? { ok: true, text: "Done. We will not try to identify you again, and we deleted what we held for this address." } : { ok: false, text: json.error ?? "Could not send that." });
      if (res.ok) setEmail("");
    } catch {
      setMsg({ ok: false, text: "Could not reach the server. Try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-panel border border-line bg-panel p-4">
      <Field label="Your email address" htmlFor="optout-email" help="We store a one-way hash of it to remember your choice, not the address itself.">
        <Input id="optout-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={busy || email.trim() === ""}>Opt out and delete my data</Button>
      </div>
      {msg && <p role="status" className={msg.ok ? "rounded-control bg-brand-soft p-2 text-link" : "rounded-control bg-high-soft p-2 text-high"}>{msg.text}</p>}
    </form>
  );
}
