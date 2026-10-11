import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/guard";
import Link from "next/link";
import { PersonSetupClient } from "@/components/PersonSetupClient";
import { SampleBanner } from "@/components/SampleBanner";
import { getView } from "@/lib/app";

export const metadata: Metadata = { title: "Person-level setup" };
export const dynamic = "force-dynamic";

export default async function PersonSetupPage() {
  await requireAdminPage();
  const v = await getView();
  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-3xl space-y-2">
        <h1 className="text-20 font-semibold">Person-level identification (optional, US only)</h1>
        <p className="text-mute">Company-level is the default and needs none of this. Person-level tries to name the individual behind a visit. It is off until you finish this page.</p>
      </div>
      {v.demo && <SampleBanner />}
      <article className="max-w-3xl space-y-3 [&_h2]:mt-3 [&_h2]:text-16 [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc">
        <h2>What it does</h2>
        <ul>
          <li>The snippet sends a first-party random id and the page URL, only after the visitor consents, and never when the browser sends Global Privacy Control or Do Not Track.</li>
          <li>The server checks that the address is in an allowed country. The EU, EEA, UK and Switzerland are always refused. An unknown country is refused.</li>
          <li>It then looks for an identity in three steps. An email hash your site already holds. Your own supplier through the HTTP adapter. A looot enrichment call that turns a hash into a name, title and LinkedIn URL.</li>
          <li>It stores hashes, not raw emails. It deletes people after the retention window. It logs every lookup and every refusal.</li>
        </ul>
        <h2>What it does not do</h2>
        <ul>
          <li>It does not ship an identity supplier, and looot does not supply person-level visitor identity. Without your own supplier or your own known emails, it identifies no one.</li>
          <li>It makes no call from the visitor&apos;s browser to any ad-tech or ID-sync network. Every supplier call is made by your server.</li>
          <li>It is not legal advice. Person-level identification is regulated, and rules differ by state. Have a lawyer review your use before you turn it on.</li>
        </ul>
        <p>
          Once it is on, the <Link href="/people" className="text-link hover:underline">People</Link>, <Link href="/suppression" className="text-link hover:underline">Suppression and opt-out</Link> and <Link href="/audit" className="text-link hover:underline">Audit log</Link> pages appear in the sidebar. The public opt-out page is at <span className="num">/optout</span>.
        </p>
      </article>
      <PersonSetupClient config={v.config} demo={v.demo} />
    </div>
  );
}
