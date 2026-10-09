import { NextResponse } from "next/server";
import { purge } from "@/lib/app";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(await purge());
}
