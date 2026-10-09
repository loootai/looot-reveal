import { NextResponse } from "next/server";
import { importText } from "@/lib/app";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { text?: string; format?: string } | null;
  if (!body?.text) return NextResponse.json({ error: "text is required" }, { status: 400 });
  const format = ["auto", "combined", "csv", "jsonl"].includes(body.format ?? "auto") ? (body.format as "auto") : "auto";
  return NextResponse.json(await importText(body.text, format));
}
