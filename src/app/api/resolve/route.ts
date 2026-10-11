import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/auth/guard";
import { runResolve } from "@/lib/app";

export const runtime = "nodejs";

/** Admin, paid. The request body is not read: the cap and the budget come from server config. */
export async function POST(req: Request) {
  const denied = await requireAdminRoute(req);
  if (denied) return denied;
  try {
    return NextResponse.json(await runResolve());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
