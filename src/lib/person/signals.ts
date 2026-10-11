import { isSha256 } from "./hash";
import type { VisitSignals } from "./engine";

/** The JSON body public/reveal.js sends. Every field is untrusted. */
export interface CollectBody {
  path?: unknown;
  referrer?: unknown;
  consent?: unknown;
  origin?: unknown;
  vid?: unknown;
  emailHash?: unknown;
  personConsent?: unknown;
  gpc?: unknown;
  dnt?: unknown;
}

const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined);

const COUNTRY_HEADERS = ["x-vercel-ip-country", "cf-ipcountry", "cloudfront-viewer-country", "x-country-code", "x-appengine-country"];

/** Builds the person-level signals from the request. GPC and DNT come from the headers as well as the body, so a snippet cannot hide them. */
export function signalsFromRequest(headers: Headers, body: CollectBody, ip: string): VisitSignals {
  let country: string | undefined;
  for (const h of COUNTRY_HEADERS) {
    const v = headers.get(h)?.trim().toUpperCase();
    if (v && /^[A-Z]{2}$/.test(v) && v !== "XX" && v !== "T1") {
      country = v;
      break;
    }
  }
  const eh = str(body.emailHash, 64);
  return {
    ip,
    userAgent: (headers.get("user-agent") ?? "").slice(0, 300),
    path: str(body.path, 200) ?? "/",
    origin: str(body.origin, 200),
    visitorId: str(body.vid, 64),
    emailHash: eh && isSha256(eh) ? eh.toLowerCase() : undefined,
    gpc: headers.get("sec-gpc") === "1" || body.gpc === true,
    dnt: headers.get("dnt") === "1" || body.dnt === true,
    personConsent: body.personConsent === true,
    country,
  };
}
