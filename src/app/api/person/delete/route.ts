import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/auth/guard";
import { deleteEmail } from "@/lib/app";
import { looksLikeEmail } from "@/lib/person/hash";

export const runtime = "nodejs";

/** Deletes everything stored for one email. With suppress: true it also keeps that person from being looked up again. */
export async function POST(req: Request) {
  const denied = await requireAdminRoute(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { email?: unknown; suppress?: unknown } | null;
  if (typeof body?.email !== "string" || !looksLikeEmail(body.email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  return NextResponse.json(await deleteEmail(body.email, body.suppress === true));
}
