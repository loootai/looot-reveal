import { NextResponse } from "next/server";
import { optOut } from "@/lib/app";
import { looksLikeEmail } from "@/lib/person/hash";

export const runtime = "nodejs";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/**
 * Public opt-out. Link /optout from your privacy notice. A POST with { "email": "..." } (JSON or a form)
 * adds the email's SHA-256 and MD5 to the suppression list and deletes what is stored for them.
 * The address itself is not stored.
 */
export async function POST(req: Request) {
  const type = req.headers.get("content-type") ?? "";
  let email = "";
  if (type.includes("application/json") || type.includes("text/plain")) {
    const body = (await req.text().then((t) => JSON.parse(t)).catch(() => null)) as { email?: unknown } | null;
    email = typeof body?.email === "string" ? body.email : "";
  } else {
    const form = await req.formData().catch(() => null);
    const v = form?.get("email");
    email = typeof v === "string" ? v : "";
  }
  email = email.trim();
  if (email.length > 254 || !looksLikeEmail(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400, headers: CORS });
  await optOut(email);
  return NextResponse.json({ ok: true }, { headers: CORS });
}
