import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as personRun } from "@/app/api/person/run/route";
import { POST as resolve } from "@/app/api/resolve/route";
import { resetLimits } from "@/lib/auth/limits";
import { CSRF_HEADER, csrfToken, verifySession } from "@/lib/auth/session";
import { sha256Email } from "@/lib/person/hash";
import { queuePersonVisit } from "@/lib/person/engine";
import { PERSON_CONDITIONS } from "@/lib/person/schema";
import { ConfigSchema, DEFAULT_CONFIG, DEFAULT_PROVIDERS } from "@/lib/config";
import { addVisits, emptyState } from "@/lib/state";
import { saveState } from "@/lib/store";
import { GET as budgetGet, PUT as budgetPut } from "./route";

const PW = "test-password-123456";
const KEYS = ["LOOOT_TOKEN", "LOOOT_API_URL", "REVEAL_DATA", "REVEAL_CONFIG", "REVEAL_ADMIN_PASSWORD", "NEXT_PUBLIC_DEMO", "LOOOT_REVEAL_DAILY_USD", "LOOOT_REVEAL_MONTHLY_USD"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
let server: Server;
let paid: string[] = [];
let dir: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method !== "POST") return void res.end(JSON.stringify({ runId: "r", status: "completed", result: {}, actualCost: 0 }));
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const b = JSON.parse(raw) as { endpointId: string };
      paid.push(b.endpointId);
      const person = b.endpointId === "people-data-labs-person-enrich";
      res.end(JSON.stringify({ runId: `r${paid.length}`, status: "completed", result: person ? { status: 200, likelihood: 9, data: { full_name: "Ada Example", linkedin_url: "linkedin.com/in/ada" } } : { company: { name: "Acme", domain: "acme.example", type: "business" }, country: "US" }, actualCost: person ? 0.28 : 0.0005 }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.LOOOT_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const ipinfoOnly = DEFAULT_PROVIDERS.map((p) => ({ ...p, enabled: p.id === "ipinfo" }));
const person = { enabled: true, acknowledgedTerms: "2026-10-11", acknowledgedConditions: PERSON_CONDITIONS.map((c) => c.id), spendCapUsd: 0.3, enrich: { enabled: true } };

beforeEach(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  dir = mkdtempSync(join(process.cwd(), ".vitest", "budget-route-"));
  process.env.REVEAL_DATA = join(dir, "reveal.json");
  process.env.REVEAL_CONFIG = join(dir, "reveal.config.json");
  process.env.REVEAL_ADMIN_PASSWORD = PW;
  process.env.LOOOT_TOKEN = "lt_test_token";
  delete process.env.NEXT_PUBLIC_DEMO;
  delete process.env.LOOOT_REVEAL_DAILY_USD;
  delete process.env.LOOOT_REVEAL_MONTHLY_USD;
  paid = [];
  resetLimits();
  // Server config: a cap of $0.002 per run, which is four lookups at $0.0005. 30 addresses wait.
  const config = ConfigSchema.parse({ ...DEFAULT_CONFIG, spendCapUsd: 0.002, enrich: false, waterfall: { providers: ipinfoOnly, crossCheck: false, cacheDays: 30, skipCidrs: [] }, personLevel: person });
  writeFileSync(process.env.REVEAL_CONFIG, JSON.stringify(config));
  const state = emptyState();
  const csv = Array.from({ length: 30 }, (_, i) => ({ ip: `203.0.113.${i + 1}`, path: "/", ts: "2026-10-11T10:00:00.000Z" }));
  addVisits(state, csv, config, new Date("2026-10-11T12:00:00Z"));
  for (let i = 0; i < 5; i++) queuePersonVisit(state, config, { ip: `198.51.100.${i + 1}`, userAgent: "ua", path: "/pricing", visitorId: `v${i}`, emailHash: sha256Email(`p${i}@example.org`), gpc: false, dnt: false, personConsent: true, country: "US" }, new Date("2026-10-11T12:00:00Z"));
  saveState(process.env.REVEAL_DATA, state);
});

const H = { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json", "x-forwarded-for": "198.51.100.7" };
async function session() {
  const res = await login(new Request("http://localhost:3000/api/auth/login", { method: "POST", headers: H, body: JSON.stringify({ password: PW }) }));
  const cookie = /reveal_session=[^;]+/.exec(res.headers.get("set-cookie") ?? "")![0];
  const s = (await verifySession(process.env, cookie.split("=")[1]))!;
  return { cookie, token: await csrfToken(process.env, s.sid) };
}
type S = Awaited<ReturnType<typeof session>>;
const call = (fn: (r: Request) => Promise<Response>, method: string, path: string, body: unknown, s: S) => fn(new Request(`http://localhost:3000${path}`, { method, headers: { ...H, cookie: s.cookie, [CSRF_HEADER]: s.token }, body: body === undefined ? undefined : JSON.stringify(body) }));
const status = async (s: S) => (await (await budgetGet(new Request("http://localhost:3000/api/budget", { headers: { ...H, cookie: s.cookie } }))).json()) as { limits: { dailyMicros: number; monthlyMicros: number }; day: { limitMicros: number; usedMicros: number; reservedMicros: number; remainingMicros: number } };

describe("budget over HTTP", () => {
  it("shows used, reserved and remaining", async () => {
    const s = await session();
    const res = await budgetGet(new Request("http://localhost:3000/api/budget", { headers: { ...H, cookie: s.cookie } }));
    const j = (await res.json()) as { day: { limitMicros: number; remainingMicros: number } };
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(j.day.remainingMicros).toBe(j.day.limitMicros);
  });

  it("refuses to change the budget without a session, and without the CSRF token", async () => {
    expect((await budgetPut(new Request("http://localhost:3000/api/budget", { method: "PUT", headers: H, body: JSON.stringify({ dailyUsd: 1000, monthlyUsd: 5000 }) }))).status).toBe(401);
    const s = await session();
    const noCsrf = await budgetPut(new Request("http://localhost:3000/api/budget", { method: "PUT", headers: { ...H, cookie: s.cookie }, body: JSON.stringify({ dailyUsd: 1000, monthlyUsd: 5000 }) }));
    expect(noCsrf.status).toBe(403);
  });

  it("lets the signed-in owner change the budget", async () => {
    const s = await session();
    expect((await call(budgetPut, "PUT", "/api/budget", { dailyUsd: 1, monthlyUsd: 3 }, s)).status).toBe(200);
    expect((await status(s)).limits).toEqual({ dailyMicros: 1_000_000, monthlyMicros: 3_000_000 });
  });
});

describe("a caller cannot set the cap or the budget", () => {
  it("ignores capUsd in a resolve request: the server cap of $0.002 holds", async () => {
    const s = await session();
    const res = await call(resolve, "POST", "/api/resolve", { capUsd: 1000 }, s);
    expect(res.status).toBe(200);
    expect(paid.length).toBeLessThanOrEqual(4);
    expect(paid.length).toBeGreaterThan(0);
  });

  it("ignores capUsd in a person run request: the server cap of $0.30 holds", async () => {
    const s = await session();
    const res = await call(personRun, "POST", "/api/person/run", { capUsd: 1000 }, s);
    expect(res.status).toBe(200);
    expect(paid.filter((e) => e === "people-data-labs-person-enrich").length).toBe(1);
  });

  it("ignores a budget sent in a run request", async () => {
    const s = await session();
    await call(budgetPut, "PUT", "/api/budget", { dailyUsd: 0.001, monthlyUsd: 0.002 }, s);
    const res = await call(resolve, "POST", "/api/resolve", { dailyUsd: 1e9, monthlyUsd: 1e9, budget: { dailyUsd: 1e9 }, limits: { dailyMicros: 1e15 } }, s);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/budget/i);
    expect(paid).toHaveLength(0);
    expect((await status(s)).limits.dailyMicros).toBe(1_000);
  });

  it("stops at the period budget across runs and says so", async () => {
    const s = await session();
    await call(budgetPut, "PUT", "/api/budget", { dailyUsd: 0.001, monthlyUsd: 0.001 }, s);
    const res = await call(resolve, "POST", "/api/resolve", {}, s);
    expect(paid.length).toBe(0);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/budget/i);
  });
});
