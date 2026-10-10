import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { getView } from "@/lib/app";

export const metadata: Metadata = { title: "Sources and snippet" };
export const dynamic = "force-dynamic";

const SNIPPET = `<script src="https://YOUR-HOST/reveal.js" defer></script>
<!-- in your cookie banner, after the visitor accepts: -->
<script>window.revealGrant && window.revealGrant();</script>`;

export default async function SourcesPage() {
  const v = await getView();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-20 font-semibold">Sources and snippet</h1>
        <p className="max-w-3xl text-mute">Visitor IPs reach looot-reveal three ways. Collecting them costs nothing. Money is spent only when you run a lookup.</p>
      </div>
      <section className="rounded-panel border border-line bg-panel p-4" aria-labelledby="snippet">
        <h2 id="snippet" className="font-semibold">Tracking snippet</h2>
        <p className="mb-2 text-mute">The snippet sends the page path and the referrer origin, and only after the visitor consents. It never sends when the browser signals Global Privacy Control or Do Not Track. The server reads the IP from the request, stores it until it is resolved, then keeps a salted hash.</p>
        <pre className="num overflow-x-auto rounded-control bg-hover p-3 text-12">{SNIPPET}</pre>
        <p className="mt-2 text-12 text-mute">Collected IPs wait for a lookup on the Import page. Retention: {v.retention.days} days.</p>
      </section>
      <section className="rounded-panel border border-line bg-panel p-4" aria-labelledby="logs">
        <h2 id="logs" className="font-semibold">Server log or CSV</h2>
        <p className="mb-3 text-mute">Paste or upload a web server access log in combined format, a CSV with an ip column, or JSON lines. Assets, bots and error responses are dropped, and query strings are cut before anything is stored. From a terminal, <span className="num">npm run reveal -- --input access.log</span> does the same and shares this app&apos;s state file.</p>
        <Link href="/import" className={buttonClass("secondary")}>Open Import and run</Link>
      </section>
      <p className="text-12 text-mute">{v.pendingIps} IPs are waiting for a lookup. {v.feed.totalVisits} page views are stored.</p>
    </div>
  );
}
