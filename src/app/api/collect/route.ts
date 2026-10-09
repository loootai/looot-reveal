import { NextResponse } from "next/server";
import { collectVisit } from "@/lib/app";

export const runtime = "nodejs";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/**
 * Receives one page view from public/reveal.js. The browser sends nothing unless the visitor consented.
 * This route stores the view only when the body says consent was given. It makes no looot call.
 */
export async function POST(req: Request) {
  const body = (await req.text().then((t) => JSON.parse(t)).catch(() => null)) as { path?: string; referrer?: string; consent?: boolean } | null;
  if (!body || body.consent !== true || typeof body.path !== "string") return NextResponse.json({ error: "consent and path are required" }, { status: 400, headers: CORS });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "";
  if (!ip) return NextResponse.json({ error: "no client address" }, { status: 400, headers: CORS });
  await collectVisit(ip, body.path, typeof body.referrer === "string" ? body.referrer : undefined);
  return new Response(null, { status: 204, headers: CORS });
}
