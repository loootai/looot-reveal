import { NextResponse } from "next/server";
import { runPerson } from "@/lib/app";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { capUsd?: number };
  try {
    return NextResponse.json(await runPerson(typeof body.capUsd === "number" ? body.capUsd : undefined));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
