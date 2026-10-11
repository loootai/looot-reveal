import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as optout } from "../optout/route";
import { PERSON_CONDITIONS } from "@/lib/person/schema";
import { sha256Email } from "@/lib/person/hash";
import { POST } from "./route";

const ON = { personLevel: { enabled: true, acknowledgedTerms: "2026-10-11", acknowledgedConditions: PERSON_CONDITIONS.map((c) => c.id) } };
let dir: string;
const saved = { data: process.env.REVEAL_DATA, config: process.env.REVEAL_CONFIG, demo: process.env.NEXT_PUBLIC_DEMO };

const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/collect", { method: "POST", headers: { "x-forwarded-for": "203.0.113.9", "user-agent": "UA", ...headers }, body: JSON.stringify(body) });
const state = () => JSON.parse(readFileSync(join(dir, "state.json"), "utf8")) as { visits: unknown[]; person?: { pending: unknown[]; audit: { outcome: string }[]; suppression: unknown[] } };
const setConfig = (c: unknown) => writeFileSync(join(dir, "reveal.config.json"), JSON.stringify(c));
const PERSON = { personOnly: true, consent: true, path: "/pricing", origin: "https://s.example", vid: "v1", personConsent: true, emailHash: sha256Email("ada@example.com") };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "reveal-route-"));
  process.env.REVEAL_DATA = join(dir, "state.json");
  process.env.REVEAL_CONFIG = join(dir, "reveal.config.json");
  delete process.env.NEXT_PUBLIC_DEMO;
});
afterEach(() => {
  for (const [k, v] of [["REVEAL_DATA", saved.data], ["REVEAL_CONFIG", saved.config], ["NEXT_PUBLIC_DEMO", saved.demo]] as const) {
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
