import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/guard";
import { IcpClient } from "@/components/IcpClient";
import { getView } from "@/lib/app";

export const metadata: Metadata = { title: "ICP" };
export const dynamic = "force-dynamic";

export default async function IcpPage() {
  await requireAdminPage();
  const v = await getView();
  const matched = v.feed.companies.filter((c) => c.icp.matched).length;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-20 font-semibold">Ideal customer profile</h1>
        <p className="max-w-3xl text-mute">{matched} of {v.feed.companies.length} visiting companies match today. Every flag lists the signals behind it, with the value seen and the provider that supplied it.</p>
      </div>
      <IcpClient config={v.config} demo={v.demo} />
    </div>
  );
}
