import { NextResponse } from "next/server";
import { collectPerson, collectVisit, recordBrowserSignal } from "@/lib/app";
import { signalsFromRequest, type CollectBody } from "@/lib/person/signals";

export const runtime = "nodejs";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/**
 * Receives one page view from public/reveal.js. The browser sends nothing unless the visitor consented.
 * This route stores the view only when the body says consent was given. It makes no looot call.
 * A body with personOnly: true carries the person-level fields (vid, emailHash, personConsent). It stores no company-level visit,
 * and it does nothing at all while person-level is off.
 * A body with only { signal: "gpc" | "dnt" } records that a browser objected. It stores no address and no id.
 */
export async function POST(req: Request) {
  const body = (await req.text().then((t) => JSON.parse(t)).catch(() => null)) as (CollectBody & { signal?: unknown; personOnly?: unknown }) | null;
  if (body && (body.signal === "gpc" || body.signal === "dnt") && body.path === undefined) {
    await recordBrowserSignal(body.signal);
    return new Response(null, { status: 204, headers: CORS });
  }
  if (!body || body.consent !== true || typeof body.path !== "string") return NextResponse.json({ error: "consent and path are required" }, { status: 400, headers: CORS });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "";
  if (!ip) return NextResponse.json({ error: "no client address" }, { status: 400, headers: CORS });
  if (body.personOnly === true) {
    await collectPerson(signalsFromRequest(req.headers, body, ip));
    return new Response(null, { status: 204, headers: CORS });
  }
  await collectVisit(ip, body.path, typeof body.referrer === "string" ? body.referrer : undefined);
  return new Response(null, { status: 204, headers: CORS });
}
