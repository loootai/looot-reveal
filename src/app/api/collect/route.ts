import { collectPerson, collectVisit, getCollectPolicy, recordBrowserSignal } from "@/lib/app";
import { allow, clientIp } from "@/lib/auth/limits";
import { cleanCollectBody, originAllowed, readLimited } from "@/lib/auth/publicInput";
import { signalsFromRequest } from "@/lib/person/signals";

export const runtime = "nodejs";

/** Page views per address per minute. The snippet sends one or two per page. */
const COLLECT_PER_MINUTE = 60;

function reply(status: number, origin: string | null, body?: Record<string, string>): Response {
  const headers: Record<string, string> = { "Cache-Control": "no-store", Vary: "Origin" };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "600";
  }
  return body ? Response.json(body, { status, headers }) : new Response(null, { status, headers });
}

/** Preflight. Answers with CORS headers only for an origin in allowedOrigins. */
export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  const policy = await getCollectPolicy();
  return reply(204, policy.demo || originAllowed(origin, policy.allowedOrigins) ? origin : null);
}

/**
 * Public by design: public/reveal.js posts here from your site. It never returns stored data, only 204 or a short error.
 * Checks, in order: origin is in allowedOrigins, rate limit per address, body under 2 KB, only the known fields are read.
 * Stores a view only when the body says consent was given. Makes no looot call.
 * A body with personOnly: true carries the person-level fields and stores no company-level visit.
 * A body with only { signal: "gpc" | "dnt" } records that a browser objected. It stores no address and no id.
 */
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const policy = await getCollectPolicy();
  if (!policy.demo && !originAllowed(origin, policy.allowedOrigins)) return reply(403, null, { error: "origin_not_allowed" });
  const ip = clientIp(req.headers);
  if (!allow(`collect:${ip}`, COLLECT_PER_MINUTE, 60_000)) return reply(429, origin, { error: "rate_limited" });
  const text = await readLimited(req);
  if (text === null) return reply(413, origin, { error: "too_large" });
  const body = cleanCollectBody(await Promise.resolve().then(() => JSON.parse(text)).catch(() => null));
  if (!body) return reply(400, origin, { error: "bad_request" });
  if (body.signal && body.path === undefined) {
    await recordBrowserSignal(body.signal);
    return reply(204, origin);
  }
  if (body.consent !== true || typeof body.path !== "string") return reply(400, origin, { error: "bad_request" });
  if (ip === "unknown") return reply(400, origin, { error: "bad_request" });
  if (body.personOnly === true) {
    await collectPerson(signalsFromRequest(req.headers, body, ip));
    return reply(204, origin);
  }
  await collectVisit(ip, body.path, body.referrer as string | undefined);
  return reply(204, origin);
}
