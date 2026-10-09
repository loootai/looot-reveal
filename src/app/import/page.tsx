import type { Metadata } from "next";
import { ImportClient } from "@/components/ImportClient";
import { getView } from "@/lib/app";

export const metadata: Metadata = { title: "Import" };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const v = await getView();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-20 font-semibold">Import visits</h1>
        <p className="text-mute">Adding visits costs nothing. You see the price of the lookups before you run them.</p>
      </div>
      <ImportClient quote={v.quote} pending={v.pendingIps} demo={v.demo} hasToken={v.hasToken} capUsd={v.config.spendCapUsd} />
    </div>
  );
}
