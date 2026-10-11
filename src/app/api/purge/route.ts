import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/auth/guard";
import { purge } from "@/lib/app";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const denied = await requireAdminRoute(req);
  if (denied) return denied;
  return NextResponse.json(await purge());
}
