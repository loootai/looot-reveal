import { optOut } from "@/lib/app";
import { allow, clientIp } from "@/lib/auth/limits";
import { readLimited } from "@/lib/auth/publicInput";
import { looksLikeEmail } from "@/lib/person/hash";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
/** Opt-outs per address per hour. A person needs one. */
const OPTOUT_PER_HOUR = 10;

/** No CORS headers: the opt-out page posts from the same origin, and other sites get no read access. */
export function OPTIONS() {
  return new Response(null, { status: 204, headers: NO_STORE });
}

/**
 * Public by design. Link /optout from your privacy notice. A POST with { "email": "..." } (JSON or a form)
 * adds the email's SHA-256 and MD5 to the suppression list and deletes what is stored for them.
 * The address itself is not stored. The answer is the same whether or not the address was known,
 * so nobody can use this route to test whether an email is in the data.
 */
export async function POST(req: Request) {
  if (!allow(`optout:${clientIp(req.headers)}`, OPTOUT_PER_HOUR, 3_600_000)) return Response.json({ error: "Too many requests. Try again later." }, { status: 429, headers: NO_STORE });
  const text = await readLimited(req);
  if (text === null) return Response.json({ error: "Enter a valid email address." }, { status: 413, headers: NO_STORE });
  const type = req.headers.get("content-type") ?? "";
  let email = "";
  if (type.includes("application/json") || type.includes("text/plain")) {
    try {
      const body = JSON.parse(text) as { email?: unknown } | null;
      email = typeof body?.email === "string" ? body.email : "";
    } catch {
      email = "";
    }
  } else {
    email = new URLSearchParams(text).get("email") ?? "";
  }
  email = email.trim();
  if (email.length > 254 || !looksLikeEmail(email)) return Response.json({ error: "Enter a valid email address." }, { status: 400, headers: NO_STORE });
  await optOut(email);
  return Response.json({ ok: true }, { headers: NO_STORE });
}
