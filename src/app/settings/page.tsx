import type { Metadata } from "next";
import { SettingsClient } from "@/components/SettingsClient";
import { getView } from "@/lib/app";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

const SNIPPET = `<script src="https://YOUR-HOST/reveal.js" defer></script>
<!-- in your cookie banner, after the visitor accepts: -->
<script>window.revealGrant && window.revealGrant();</script>`;

export default async function SettingsPage() {
  const v = await getView();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-20 font-semibold">Settings</h1>
        <p className="text-mute">ICP signals and their weights, the IP lookup, the spend cap and the retention window all live in one file, reveal.config.json.</p>
      </div>
      <SettingsClient configJson={JSON.stringify(v.config, null, 2)} demo={v.demo} />
      <section className="rounded-panel border border-line bg-panel p-4" aria-labelledby="snippet">
        <h2 id="snippet" className="font-semibold">
          Tracking snippet
        </h2>
        <p className="mb-2 text-mute">The snippet sends the page path and the referrer origin, and only after the visitor consents. It never sends when the browser signals Global Privacy Control or Do Not Track. The server reads the IP from the request, stores it until it is resolved, then keeps a salted hash.</p>
        <pre className="num overflow-x-auto rounded-control bg-hover p-3 text-12">{SNIPPET}</pre>
        <p className="mt-2 text-12 text-mute">Collected IPs cost nothing until you run a lookup on the Import page. Retention: {v.retention.days} days.</p>
      </section>
    </div>
  );
}
