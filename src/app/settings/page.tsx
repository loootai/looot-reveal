import type { Metadata } from "next";
import { SettingsClient } from "@/components/SettingsClient";
import { getView } from "@/lib/app";

export const metadata: Metadata = { title: "Config file" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const v = await getView();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-20 font-semibold">Config file</h1>
        <p className="text-mute">Everything the other setup pages edit lives in one file, reveal.config.json. Edit it here for settings those pages do not cover, such as ICP signal definitions and network name hints.</p>
      </div>
      <SettingsClient configJson={JSON.stringify(v.config, null, 2)} demo={v.demo} />
    </div>
  );
}
