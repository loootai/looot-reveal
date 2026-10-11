"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/misc";
import type { SuppressionEntry } from "@/lib/person/types";

async function call<T>(method: string, url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

const shorten = (v: string) => (v.length > 20 ? `${v.slice(0, 12)}...${v.slice(-4)}` : v);

export function SuppressionClient({ recent, demo }: { recent: SuppressionEntry[]; demo: boolean }) {
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [keep, setKeep] = React.useState(true);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

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
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="flex flex-col gap-3 rounded-panel border border-line bg-panel p-4" aria-labelledby="imp">
        <h2 id="imp" className="font-semibold">Add to the suppression list</h2>
        <p className="text-12 text-mute">Paste emails, SHA-256 or MD5 hashes, or domains. One per line or comma. An email becomes a SHA-256 and an MD5 entry and the address is not kept. Anything already stored for an entry is deleted.</p>
        <textarea aria-label="Emails, hashes or domains" value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder={"person@example.com\n5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8\ncompetitor.example"} className="num w-full rounded-control border border-line-strong bg-panel p-2.5 text-12 placeholder:text-faint focus-visible:border-emerald" />
        <div>
          <Button variant="primary" disabled={busy || demo || text.trim() === ""} onClick={() => act(async () => {
            const r = await call<{ added: number; skipped: number; deleted: { people: number } }>("POST", "/api/person/suppression", { text });
            setText("");
            return `Added ${r.added} entries, skipped ${r.skipped} lines that were not an email, hash or domain. Deleted ${r.deleted.people} stored people.`;
          })}>Add to the list</Button>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-panel border border-line bg-panel p-4" aria-labelledby="del">
        <h2 id="del" className="font-semibold">Delete everything stored for one email</h2>
        <p className="text-12 text-mute">Removes the person, the link between their browser and their email hash, and any queued lookup. The audit log keeps the decision and loses the link to the person.</p>
        <Field label="Email address" htmlFor="del-email">
          <Input id="del-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--emerald)]" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          <span>Also add to the suppression list<span className="block text-12 text-mute">Leave this on unless you only want to clear stored data. Without it the person can be identified again.</span></span>
        </label>
        <div>
          <Button variant="danger" disabled={busy || demo || email.trim() === ""} onClick={() => act(async () => {
            const r = await call<{ people: number; links: number }>("POST", "/api/person/delete", { email, suppress: keep });
            setEmail("");
            return `Deleted ${r.people} stored people and ${r.links} links.${keep ? " Added to the suppression list." : ""}`;
          })}>Delete stored data</Button>
        </div>
      </section>

      {demo && <p className="text-12 text-mute lg:col-span-2">The demo does not change the suppression list.</p>}
      {msg && <p role="status" className="rounded-control bg-brand-soft p-2 text-link lg:col-span-2">{msg}</p>}

      <section className="rounded-panel border border-line bg-panel lg:col-span-2" aria-labelledby="ent">
        <h2 id="ent" className="border-b border-line p-3 font-semibold">Latest entries</h2>
        {recent.length === 0 ? (
          <p className="p-6 text-center text-mute">The list is empty.</p>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <Table>
              <thead>
                <tr><Th>Type</Th><Th>Value</Th><Th>Added (UTC)</Th><Th>Source</Th><Th><span className="sr-only">Remove</span></Th></tr>
              </thead>
              <tbody>
                {recent.map((e) => (
                  <tr key={`${e.kind}-${e.value}`}>
                    <Td>{e.kind === "domain" ? "Domain" : e.kind === "sha256" ? "SHA-256" : "MD5"}</Td>
                    <Td className="num" title={e.value}>{e.kind === "domain" ? e.value : shorten(e.value)}</Td>
                    <Td className="num whitespace-nowrap">{e.addedAt.slice(0, 16).replace("T", " ")}</Td>
                    <Td>{e.source}</Td>
                    <Td className="text-right">
                      <Button size="sm" variant="ghost" disabled={busy || demo} onClick={() => act(async () => {
                        await call("DELETE", "/api/person/suppression", { kind: e.kind, value: e.value });
                        return "Removed from the list.";
                      })}>Remove</Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
