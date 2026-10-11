import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { HttpAdapterSchema } from "./schema";
import { createHttpAdapter, getPath, mapCandidates } from "./httpAdapter";
import { parsePdlPerson } from "./enrich";
import { md5Email, normaliseEmail, sha256Email, isMd5, isSha256 } from "./hash";
import { signalsFromRequest } from "./signals";

const input = { ip: "203.0.113.9", userAgent: "UA", visitorId: "v1", pageUrl: "https://s.example/p", timestamp: "2026-10-11T12:00:00.000Z" };

describe("hashing", () => {
  it("normalises then hashes", () => {
    expect(normaliseEmail(`  ${"Ada"}@${"Example.COM"}`)).toBe("ada@example.com");
    expect(sha256Email(`${" Ada"}@${"Example.com"}`)).toBe(createHash("sha256").update("ada@example.com").digest("hex"));
    expect(md5Email("ada@example.com")).toBe(createHash("md5").update("ada@example.com").digest("hex"));
    expect(isSha256(sha256Email("a@example.org"))).toBe(true);
    expect(isMd5(md5Email("a@example.org"))).toBe(true);
    expect(isSha256("ada@example.com")).toBe(false);
  });
});

describe("getPath", () => {
  it("reads dotted paths and array indexes", () => {
    const o = { a: { b: [{ c: 1 }, { c: 2 }] } };
    expect(getPath(o, "a.b.1.c")).toBe(2);
    expect(getPath(o, "a.x.y")).toBeUndefined();
    expect(getPath(o, "")).toBe(o);
  });
});

describe("mapCandidates", () => {
  const resp = HttpAdapterSchema.parse({ url: "https://x.example/r", response: { matchesPath: "results", fields: { emailSha256: "h", name: "n", workEmail: "e", confidence: "c" }, confidenceScale: 10 } }).response;
  it("returns every match, scales confidence and hashes a work email the supplier sent without a hash", () => {
    const out = mapCandidates({ results: [{ n: "A", e: "A@example.org", c: 9 }, { n: "B", h: sha256Email("b@example.org"), c: 3 }, { c: 1 }] }, resp, "sup");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ name: "A", workEmail: "A@example.org", emailSha256: sha256Email("a@example.org"), emailMd5: md5Email("a@example.org"), confidence: 0.9, supplier: "sup", costMicros: 0 });
    expect(out[1]).toMatchObject({ name: "B", emailSha256: sha256Email("b@example.org"), confidence: 0.3 });
  });
  it("treats the root object as one candidate when matchesPath is empty", () => {
    const flat = HttpAdapterSchema.parse({ url: "https://x.example/r", response: { fields: { name: "name", linkedinUrl: "li" } } }).response;
    expect(mapCandidates({ name: "Z", li: "https://www.linkedin.com/in/z" }, flat, "s")).toHaveLength(1);
    expect(mapCandidates({}, flat, "s")).toEqual([]);
  });
  it("ignores a value of the wrong type and a hash that is not a hash", () => {
    const out = mapCandidates({ results: [{ n: 5, h: "nope", e: "x@example.org" }] }, resp, "s");
    expect(out[0].name).toBeUndefined();
    expect(out[0].emailSha256).toBe(sha256Email("x@example.org"));
  });
});

describe("createHttpAdapter", () => {
  const cfg = HttpAdapterSchema.parse({
    enabled: true,
    label: "acme",
    url: "https://api.acme.example/id",
    method: "GET",
    authHeader: "Authorization",
    authEnv: "ACME_KEY",
    priceUsd: 0.1,
    request: { fields: { ip: "ip", pageUrl: "url" } },
    response: { matchesPath: "m", fields: { name: "n" } },
  });
  it("puts mapped fields in the query string for GET and sends Bearer by default", async () => {
    const f = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify({ m: [{ n: "Q" }] })));
    const out = await createHttpAdapter(cfg).lookup(input, { fetch: f as unknown as typeof fetch, env: { ACME_KEY: "k1" } });
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe("https://api.acme.example/id?ip=203.0.113.9&url=https%3A%2F%2Fs.example%2Fp");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer k1");
    expect(init!.body).toBeUndefined();
    expect(out.candidates[0].name).toBe("Q");
  });
  it("reports a failure on HTTP 4xx and 5xx without throwing", async () => {
    const f = vi.fn(async () => new Response("bad", { status: 403 }));
    const out = await createHttpAdapter(cfg).lookup(input, { fetch: f as unknown as typeof fetch, env: { ACME_KEY: "k1" } });
    expect(out).toMatchObject({ candidates: [], failed: "http_403" });
  });
  it("reports a missing key and does not call", async () => {
    const f = vi.fn();
    const out = await createHttpAdapter(cfg).lookup(input, { fetch: f as unknown as typeof fetch, env: {} });
    expect(f).not.toHaveBeenCalled();
    expect(out.failed).toBe("missing_key");
  });
  it("reports a network error without throwing", async () => {
    const f = vi.fn(async () => {
      throw new Error("boom");
    });
    const out = await createHttpAdapter(cfg).lookup(input, { fetch: f as unknown as typeof fetch, env: { ACME_KEY: "k" } });
    expect(out.failed).toBe("request_failed");
  });
});

describe("parsePdlPerson", () => {
  it("reads the People Data Labs person body", () => {
    expect(parsePdlPerson({ status: 200, likelihood: 8, data: { full_name: "Ada Example", job_title: "CTO", job_company_name: "Ex", job_company_website: "ex.example", linkedin_url: "linkedin.com/in/ada", work_email: "ada@example.org" } })).toMatchObject({ name: "Ada Example", title: "CTO", company: "Ex", companyDomain: "ex.example", linkedinUrl: "linkedin.com/in/ada", workEmail: "ada@example.org", confidence: 0.8 });
  });
  it("returns null for a no-match body", () => {
    expect(parsePdlPerson({ status: 404, error: { type: "not_found" } })).toBeNull();
    expect(parsePdlPerson(null)).toBeNull();
  });
});

describe("signalsFromRequest", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it("reads GPC and DNT from the request headers, whatever the body says", () => {
    expect(signalsFromRequest(h({ "sec-gpc": "1", "user-agent": "UA" }), { path: "/x", personConsent: true }, "203.0.113.9").gpc).toBe(true);
    expect(signalsFromRequest(h({ dnt: "1" }), { path: "/x", personConsent: true }, "203.0.113.9").dnt).toBe(true);
    expect(signalsFromRequest(h({}), { path: "/x", personConsent: true, gpc: true }, "203.0.113.9").gpc).toBe(true);
  });
  it("takes the country from a CDN header and the user agent from the request", () => {
    const s = signalsFromRequest(h({ "x-vercel-ip-country": "us", "user-agent": "UA/1" }), { path: "/p", origin: "https://s.example", vid: "v", personConsent: true }, "203.0.113.9");
    expect(s).toMatchObject({ country: "US", userAgent: "UA/1", path: "/p", visitorId: "v", ip: "203.0.113.9", personConsent: true });
  });
  it("treats a missing consent flag as no consent and drops a bad hash", () => {
    const s = signalsFromRequest(h({}), { path: "/p", emailHash: "not-a-hash" }, "203.0.113.9");
    expect(s.personConsent).toBe(false);
    expect(s.emailHash).toBeUndefined();
  });
});
