import type { Metadata } from "next";
import { OptOutClient } from "@/components/OptOutClient";

export const metadata: Metadata = { title: "Opt out", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Public page. Link it from your privacy notice. It shows no admin navigation and no data. */
export default function OptOutPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-20 font-semibold">Opt out of visitor identification</h1>
      <p>This site may try to identify visitors from the United States who agreed to it. Enter your email address to stop that for you. We will add a hash of the address to our suppression list and delete anything we stored for it.</p>
      <OptOutClient />
      <p className="text-12 text-mute">Your browser can also opt you out: turn on Global Privacy Control or Do Not Track, and this site will not try to identify you.</p>
    </div>
  );
}
