import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/auth/guard";
import { addSuppression, dropSuppression } from "@/lib/app";

export const runtime = "nodejs";

/** Adds emails, hashes and domains (one per line or comma) and deletes stored data for them. */
export async function POST(req: Request) {
  const denied = await requireAdminRoute(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
  if (typeof body?.text !== "string" || body.text.trim() === "") return NextResponse.json({ error: "Paste at least one email, hash or domain." }, { status: 400 });
  if (body.text.length > 2_000_000) return NextResponse.json({ error: "That list is too large. Split it." }, { status: 400 });
  return NextResponse.json(await addSuppression(body.text));
}

/** Takes one entry off the list. */
export async function DELETE(req: Request) {
  const denied = await requireAdminRoute(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { kind?: unknown; value?: unknown } | null;
  if ((body?.kind !== "sha256" && body?.kind !== "md5" && body?.kind !== "domain") || typeof body.value !== "string") return NextResponse.json({ error: "kind and value are required." }, { status: 400 });
  return NextResponse.json({ removed: await dropSuppression(body.kind, body.value) });
}
