import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetLimits } from "@/lib/auth/limits";
import { POST as optout } from "../optout/route";
import { PERSON_CONDITIONS } from "@/lib/person/schema";
import { sha256Email } from "@/lib/person/hash";
import { OPTIONS, POST } from "./route";

const ON = { personLevel: { enabled: true, acknowledgedTerms: "2026-10-11", acknowledgedConditions: PERSON_CONDITIONS.map((c) => c.id) } };
let dir: string;
const saved = { data: process.env.REVEAL_DATA, config: process.env.REVEAL_CONFIG, demo: process.env.NEXT_PUBLIC_DEMO, pw: process.env.REVEAL_ADMIN_PASSWORD };

const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/collect", { method: "POST", headers: { "x-forwarded-for": "203.0.113.9", "user-agent": "UA", origin: "https://s.example", ...headers }, body: JSON.stringify(body) });
const state = () => JSON.parse(readFileSync(join(dir, "state.json"), "utf8")) as { visits: unknown[]; person?: { pending: unknown[]; audit: { outcome: string }[]; suppression: unknown[] } };
const setConfig = (c: object) => writeFileSync(join(dir, "reveal.config.json"), JSON.stringify({ allowedOrigins: ["https://s.example"], ...c }));
const PERSON = { personOnly: true, consent: true, path: "/pricing", origin: "https://s.example", vid: "v1", personConsent: true, emailHash: sha256Email("ada@example.com") };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "reveal-route-"));
  process.env.REVEAL_DATA = join(dir, "state.json");
  process.env.REVEAL_CONFIG = join(dir, "reveal.config.json");
  delete process.env.NEXT_PUBLIC_DEMO;
  process.env.REVEAL_ADMIN_PASSWORD = "test-password-123456";
  resetLimits();
});
afterEach(() => {
  for (const [k, v] of [["REVEAL_DATA", saved.data], ["REVEAL_CONFIG", saved.config], ["NEXT_PUBLIC_DEMO", saved.demo], ["REVEAL_ADMIN_PASSWORD", saved.pw]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("/api/collect", () => {
  it("company-level works unchanged with person-level off, and person fields are ignored", async () => {
    setConfig({});
    expect((await POST(req({ path: "/pricing", consent: true }))).status).toBe(204);
    expect((await POST(req(PERSON, { "x-vercel-ip-country": "US" }))).status).toBe(204);
    expect((await POST(req({ signal: "gpc" }))).status).toBe(204);
    const s = state();
    expect(s.visits).toHaveLength(1);
    expect(s.person).toBeUndefined();
  });
  it("queues a person-level event when it is on, with the country from a CDN header", async () => {
    setConfig(ON);
    expect((await POST(req(PERSON, { "x-vercel-ip-country": "US" }))).status).toBe(204);
    const s = state();
    expect(s.visits).toHaveLength(0);
    expect(s.person!.pending).toHaveLength(1);
  });
  it("records a skip for an EU visitor and stores no address", async () => {
    setConfig(ON);
    await POST(req(PERSON, { "x-vercel-ip-country": "DE" }));
    const s = state();
    expect(s.person!.pending).toHaveLength(0);
    expect(s.person!.audit[0].outcome).toBe("blocked_region");
    expect(JSON.stringify(s)).not.toContain("203.0.113.9");
  });
  it("honours the Sec-GPC and DNT headers even when the body says nothing", async () => {
    setConfig(ON);
    await POST(req(PERSON, { "x-vercel-ip-country": "US", "sec-gpc": "1" }));
    await POST(req(PERSON, { "x-vercel-ip-country": "US", dnt: "1" }));
    const s = state();
    expect(s.person!.pending).toHaveLength(0);
    expect(s.person!.audit.map((a) => a.outcome)).toEqual(["gpc", "dnt"]);
  });
  it("records the snippet's GPC signal once a minute, with no address", async () => {
    setConfig(ON);
    await POST(req({ signal: "gpc" }));
    await POST(req({ signal: "gpc" }));
    const s = state();
    expect(s.person!.audit).toHaveLength(1);
    expect(JSON.stringify(s)).not.toContain("203.0.113.9");
  });
  it("still refuses a body without consent", async () => {
    setConfig(ON);
    expect((await POST(req({ path: "/x" }))).status).toBe(400);
  });
});

describe("/api/optout", () => {
  const form = (email: string) => new Request("http://localhost/api/optout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
  it("suppresses and deletes, even with person-level off", async () => {
    setConfig({});
    const res = await optout(form("Ada@example.com "));
    expect(res.status).toBe(200);
    expect(state().person!.suppression).toHaveLength(2);
  });
  it("rejects something that is not an email", async () => {
    setConfig({});
    expect((await optout(form("not an email"))).status).toBe(400);
  });
  it("accepts a plain HTML form post", async () => {
    setConfig({});
    const body = new URLSearchParams({ email: "grace@example.org" });
    const res = await optout(new Request("http://localhost/api/optout", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }));
    expect(res.status).toBe(200);
  });
});

describe("/api/collect hardening", () => {
  it("refuses an origin that is not in allowedOrigins, and a request with no Origin", async () => {
    setConfig({});
    const bad = await POST(req({ path: "/x", consent: true }, { origin: "https://evil.example" }));
    expect(bad.status).toBe(403);
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
    const none = new Request("http://localhost/api/collect", { method: "POST", headers: { "x-forwarded-for": "203.0.113.9" }, body: JSON.stringify({ path: "/x", consent: true }) });
    expect((await POST(none)).status).toBe(403);
    expect(existsSync(join(dir, "state.json"))).toBe(false);
  });
  it("refuses everything while allowedOrigins is empty", async () => {
    writeFileSync(join(dir, "reveal.config.json"), JSON.stringify({}));
    expect((await POST(req({ path: "/x", consent: true }))).status).toBe(403);
  });
  it("echoes only the allowed origin in CORS headers, never a wildcard, on POST and preflight", async () => {
    setConfig({});
    const ok = await POST(req({ path: "/x", consent: true }));
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://s.example");
    const pre = await OPTIONS(new Request("http://localhost/api/collect", { method: "OPTIONS", headers: { origin: "https://s.example" } }));
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://s.example");
    const evil = await OPTIONS(new Request("http://localhost/api/collect", { method: "OPTIONS", headers: { origin: "https://evil.example" } }));
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });
  it("refuses a body over 2 KB, by header and by stream", async () => {
    setConfig({});
    const big = JSON.stringify({ path: "/x", consent: true, referrer: "r".repeat(5000) });
    expect((await POST(req(JSON.parse(big)))).status).toBe(413);
    const noLength = new Request("http://localhost/api/collect", { method: "POST", headers: { origin: "https://s.example", "x-forwarded-for": "203.0.113.9" }, body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } }), duplex: "half" } as RequestInit);
    expect((await POST(noLength)).status).toBe(413);
  });
  it("reads only the known fields and caps their length", async () => {
    setConfig({});
    await POST(req({ path: "/p".repeat(300), consent: true, admin: true, __proto__: { x: 1 }, extra: "kept?" }));
    const raw = readFileSync(join(dir, "state.json"), "utf8");
    expect(raw).not.toContain("kept?");
    expect(state().visits).toHaveLength(1);
  });
  it("rate limits one address", async () => {
    setConfig({});
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await POST(req({ path: "/x", consent: true }))).status;
    expect(last).toBe(429);
  });
  it("never returns stored data: success is an empty 204, errors are short codes", async () => {
    setConfig({});
    const ok = await POST(req({ path: "/x", consent: true }));
    expect(await ok.text()).toBe("");
    const bad = await POST(req({ path: "/x" }));
    expect(await bad.json()).toEqual({ error: "bad_request" });
    expect(ok.headers.get("cache-control")).toBe("no-store");
  });
});

describe("/api/optout hardening", () => {
  const post = (email: string, ip = "198.51.100.20") => new Request("http://localhost/api/optout", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ email }) });
  it("answers the same for an address that was stored and one that was not", async () => {
    setConfig({});
    setConfig(ON);
    await POST(req({ ...PERSON, emailHash: sha256Email("known@example.com") }, { "x-vercel-ip-country": "US" }));
    expect(state().person!.pending).toHaveLength(1);
    const known = await optout(post("known@example.com"));
    const unknown = await optout(post("nobody-here@example.com"));
    expect(known.status).toBe(unknown.status);
    expect(await known.json()).toEqual(await unknown.json());
    expect([...known.headers.keys()].sort()).toEqual([...unknown.headers.keys()].sort());
  });
  it("is rate limited per address and sets no CORS headers", async () => {
    setConfig({});
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await optout(post(`p${i}@example.com`))).status;
    expect(last).toBe(429);
    const ok = await optout(post("fresh@example.com", "198.51.100.99"));
    expect(ok.headers.get("access-control-allow-origin")).toBeNull();
  });
});
