import { isMd5, isSha256, md5Email, sha256Email } from "./hash";
import type { HttpAdapterConfig } from "./schema";
import type { AdapterContext, AdapterResult, PersonAdapter, PersonCandidate, PersonLookupInput } from "./types";

type Obj = Record<string, unknown>;

/** Reads a dotted path such as "data.matches.0.name". An empty path returns the value itself. */
export function getPath(value: unknown, path: string): unknown {
  if (!path) return value;
  let cur: unknown = value;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Obj)[part];
  }
  return cur;
}

/** Sets a dotted path in a new object, so "visitor.ip" becomes { visitor: { ip } }. */
function setPath(target: Obj, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur = target;
  parts.slice(0, -1).forEach((p) => {
    if (typeof cur[p] !== "object" || cur[p] === null) cur[p] = {};
    cur = cur[p] as Obj;
  });
  cur[parts[parts.length - 1]] = value;
}

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

/** Turns the supplier's answer into candidates using the response mapping. A candidate with no hash, name or LinkedIn URL is dropped. */
export function mapCandidates(body: unknown, map: HttpAdapterConfig["response"], supplier: string): PersonCandidate[] {
  const root = getPath(body, map.matchesPath);
  const rows = Array.isArray(root) ? root : root && typeof root === "object" ? [root] : [];
  const f = map.fields;
  const out: PersonCandidate[] = [];
  for (const row of rows) {
    const pick = (path: string | undefined) => (path ? getPath(row, path) : undefined);
    const workEmail = text(pick(f.workEmail));
    const rawSha = text(pick(f.emailSha256));
    const rawMd5 = text(pick(f.emailMd5));
    const conf = pick(f.confidence);
    const scaled = typeof conf === "number" && Number.isFinite(conf) ? Math.min(1, Math.max(0, conf / map.confidenceScale)) : undefined;
    const c: PersonCandidate = {
      emailSha256: rawSha && isSha256(rawSha) ? rawSha.toLowerCase() : workEmail ? sha256Email(workEmail) : undefined,
      emailMd5: rawMd5 && isMd5(rawMd5) ? rawMd5.toLowerCase() : workEmail ? md5Email(workEmail) : undefined,
      name: text(pick(f.name)),
      workEmail,
      linkedinUrl: text(pick(f.linkedinUrl)),
      title: text(pick(f.title)),
      company: text(pick(f.company)),
      companyDomain: text(pick(f.companyDomain))?.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""),
      confidence: scaled,
      supplier,
      costMicros: 0,
    };
    if (c.emailSha256 || c.emailMd5 || c.name || c.linkedinUrl) out.push(Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) as unknown as PersonCandidate);
  }
  return out;
}

function requestValues(input: PersonLookupInput, fields: HttpAdapterConfig["request"]["fields"]): [string, string][] {
  const pairs: [keyof typeof fields, string | undefined][] = [
    ["ip", input.ip],
    ["userAgent", input.userAgent],
    ["visitorId", input.visitorId],
    ["pageUrl", input.pageUrl],
    ["timestamp", input.timestamp],
    ["emailSha256", input.emailHash],
  ];
  return pairs.flatMap(([k, v]) => (fields[k] && v ? [[fields[k] as string, v] as [string, string]] : []));
}

/**
 * The generic adapter. Calls the supplier URL the user configured, with the key from the environment,
 * and maps the answer. It never throws: a failure comes back in `failed`.
 */
export function createHttpAdapter(cfg: HttpAdapterConfig): PersonAdapter {
  return {
    id: cfg.label,
    label: cfg.label,
    priceMicros: Math.round(cfg.priceUsd * 1_000_000),
    async lookup(input: PersonLookupInput, ctx: AdapterContext): Promise<AdapterResult> {
      const key = ctx.env[cfg.authEnv];
      if (!key) return { candidates: [], failed: "missing_key" };
      const values = requestValues(input, cfg.request.fields);
      const headers: Record<string, string> = { [cfg.authHeader]: `${cfg.authPrefix}${key}`, Accept: "application/json" };
      let url = cfg.url;
      let body: string | undefined;
      if (cfg.method === "GET") {
        const u = new URL(cfg.url);
        for (const [k, v] of values) u.searchParams.set(k, v);
        for (const [k, v] of Object.entries(cfg.request.static)) u.searchParams.set(k, String(v));
        url = u.toString();
      } else {
        const o: Obj = {};
        for (const [k, v] of values) setPath(o, k, v);
        for (const [k, v] of Object.entries(cfg.request.static)) setPath(o, k, v);
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(o);
      }
      try {
        const res = await ctx.fetch(url, { method: cfg.method, headers, body, signal: AbortSignal.timeout(cfg.timeoutMs), cache: "no-store" });
        if (!res.ok) return { candidates: [], failed: `http_${res.status}` };
        const json: unknown = await res.json().catch(() => null);
        if (json === null) return { candidates: [], failed: "bad_json" };
        return { candidates: mapCandidates(json, cfg.response, cfg.label) };
      } catch {
        return { candidates: [], failed: "request_failed" };
      }
    },
  };
}
