import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/guard";
import { SampleBanner } from "@/components/SampleBanner";
import { SuppressionClient } from "@/components/SuppressionClient";
import { getView } from "@/lib/app";
import { SAMPLE_NOTICE } from "@/lib/person/notice";

export const metadata: Metadata = { title: "Suppression and opt-out" };
export const dynamic = "force-dynamic";

export default async function SuppressionPage() {
  await requireAdminPage();
  const v = await getView();
  const s = v.person.suppression;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-20 font-semibold">Suppression and opt-out</h1>
        <p className="max-w-3xl text-mute">People on this list are never looked up, and anything stored for them is deleted. The list works even while person-level identification is off, so an opt-out is never lost.</p>
      </div>
      {v.demo && <SampleBanner />}
      <div className="grid grid-cols-3 gap-3 md:max-w-xl">
        {[["SHA-256 hashes", s.sha256], ["MD5 hashes", s.md5], ["Domains", s.domains.length]].map(([label, n]) => (
          <div key={label} className="rounded-panel border border-line bg-panel p-3">
            <div className="text-12 text-mute">{label}</div>
            <div className="num text-20 font-semibold">{n}</div>
          </div>
        ))}
      </div>
      <section className="max-w-3xl rounded-panel border border-line bg-panel p-4" aria-labelledby="pub">
        <h2 id="pub" className="font-semibold">Public opt-out page</h2>
        <p className="text-mute">Link <span className="num">/optout</span> on your reveal host from your privacy notice. It takes an email address, stores its hashes on this list and deletes what is stored. To use your own form, POST <span className="num">{`{"email": "..."}`}</span> to <span className="num">/api/optout</span>.</p>
        <p className="mt-2 text-12 text-mute">A starting paragraph for the notice. Have a lawyer edit it.</p>
        <blockquote className="mt-1 border-l-2 border-line-strong pl-3 text-13">{SAMPLE_NOTICE}</blockquote>
      </section>
      <SuppressionClient recent={s.recent} demo={v.demo} />
    </div>
  );
}
