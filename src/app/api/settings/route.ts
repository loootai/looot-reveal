import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { updateConfig } from "@/lib/app";

export const runtime = "nodejs";

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  try {
    return NextResponse.json(await updateConfig(body));
  } catch (e) {
    const message = e instanceof ZodError ? e.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`).join("; ") : (e as Error).message;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
