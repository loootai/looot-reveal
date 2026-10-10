import type { Metadata } from "next";
import { WaterfallClient } from "@/components/WaterfallClient";
import { getView } from "@/lib/app";

export const metadata: Metadata = { title: "Provider waterfall" };
export const dynamic = "force-dynamic";

export default async function WaterfallPage() {
  const v = await getView();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-20 font-semibold">Provider waterfall</h1>
        <p className="max-w-3xl text-mute">Which suppliers turn an IP address into a company, in what order, at what price. Company-level only. Nothing here identifies a person.</p>
      </div>
      <WaterfallClient config={v.config} quote={v.quote} demo={v.demo} />
    </div>
  );
}
