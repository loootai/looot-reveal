import type { CollectBody } from "../person/signals";

/** Largest body the public endpoints read. The snippet sends under 600 bytes. */
export const MAX_PUBLIC_BODY_BYTES = 2048;

/** Reads a request body as text, refusing anything over `max` bytes. Returns null when it is too big. */
export async function readLimited(req: Request, max: number = MAX_PUBLIC_BODY_BYTES): Promise<string | null> {
  const len = Number(req.headers.get("content-length"));
  if (Number.isFinite(len) && len > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      void reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** true when `origin` is in the allow-list. Compared as scheme://host[:port], lowercase, no trailing slash. */
export function originAllowed(origin: string | null, allowed: string[]): boolean {
  if (!origin) return false;
  let o: string;
  try {
    o = new URL(origin).origin.toLowerCase();
  } catch {
    return false;
  }
  return allowed.some((a) => {
    try {
      return new URL(a).origin.toLowerCase() === o;
    } catch {
      return false;
    }
  });
}

const str = (v: unknown, max: number): string | undefined => (typeof v === "string" ? v.slice(0, max) : undefined);

export type CleanCollect = CollectBody & { signal?: "gpc" | "dnt"; personOnly?: boolean };

/**
 * Keeps only the fields public/reveal.js sends, each with a type and a length cap. Unknown keys are dropped.
 * Returns null when the body is not a JSON object.
 */
export function cleanCollectBody(raw: unknown): CleanCollect | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  return {
    path: str(b.path, 200),
    referrer: str(b.referrer, 200),
    origin: str(b.origin, 200),
    vid: str(b.vid, 64),
    emailHash: str(b.emailHash, 64),
    consent: b.consent === true ? true : undefined,
    personConsent: b.personConsent === true ? true : undefined,
    personOnly: b.personOnly === true ? true : undefined,
    gpc: b.gpc === true ? true : undefined,
    dnt: b.dnt === true ? true : undefined,
    signal: b.signal === "gpc" || b.signal === "dnt" ? b.signal : undefined,
  };
}
