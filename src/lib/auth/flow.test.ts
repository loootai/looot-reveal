import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as purge } from "@/app/api/purge/route";
import { PUT as putSettings } from "@/app/api/settings/route";
import { proxy } from "@/proxy";
import { resetLimits } from "./limits";
import { updateConfigForTest } from "./testHelpers";

const PW = "test-password-123456";
const H = { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json", "x-forwarded-for": "198.51.100.7" };
const saved = { pw: process.env.REVEAL_ADMIN_PASSWORD, data: process.env.REVEAL_DATA, config: process.env.REVEAL_CONFIG, demo: process.env.NEXT_PUBLIC_DEMO };

const post = (url: string, body: unknown, headers: Record<string, string> = {}) => new Request(`http://localhost:3000${url}`, { method: "POST", headers: { ...H, ...headers }, body: JSON.stringify(body) });
const cookieOf = (res: Response) => /reveal_session=[^;]+/.exec(res.headers.get("set-cookie") ?? "")?.[0] ?? "";

beforeEach(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  const dir = mkdtempSync(join(process.cwd(), ".vitest", "flow-"));
  process.env.REVEAL_DATA = join(dir, "reveal.json");
  process.env.REVEAL_CONFIG = join(dir, "reveal.config.json");
  process.env.REVEAL_ADMIN_PASSWORD = PW;
  delete process.env.NEXT_PUBLIC_DEMO;
  resetLimits();
});
afterEach(() => {
  for (const [k, v] of [["REVEAL_ADMIN_PASSWORD", saved.pw], ["REVEAL_DATA", saved.data], ["REVEAL_CONFIG", saved.config], ["NEXT_PUBLIC_DEMO", saved.demo]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("sign in", () => {
  it("a wrong password gets 401 and no cookie", async () => {
    const res = await login(post("/api/auth/login", { password: "nope-nope-nope-nope" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it("the right password sets a hardened cookie that opens admin routes", async () => {
    const res = await login(post("/api/auth/login", { password: PW }));
    expect(res.status).toBe(200);
    const sc = res.headers.get("set-cookie")!;
    expect(sc).toMatch(/HttpOnly/);
    expect(sc).toMatch(/SameSite=Lax/);
    expect(sc).toMatch(/Max-Age=/);
    const page = await proxy(new NextRequest("http://localhost:3000/people", { headers: { cookie: cookieOf(res) } }));
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
  });
  it("a form post redirects to the page asked for, and never off site", async () => {
    const form = (next: string) => new Request("http://localhost:3000/api/auth/login", { method: "POST", headers: { host: H.host, origin: H.origin, "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": H["x-forwarded-for"] }, body: new URLSearchParams({ password: PW, next }) });
    expect((await login(form("/people"))).headers.get("location")).toBe("/people");
    expect((await login(form("//evil.example"))).headers.get("location")).toBe("/");
    expect((await login(form("https://evil.example"))).headers.get("location")).toBe("/");
  });
  it("locks the address after 5 wrong passwords, and the right password does not help until the window ends", async () => {
    for (let i = 0; i < 5; i++) expect((await login(post("/api/auth/login", { password: `wrong-password-${i}-xx` }))).status).toBe(401);
    const locked = await login(post("/api/auth/login", { password: PW }));
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(locked.headers.get("set-cookie")).toBeNull();
  });
  it("refuses a sign-in posted from another site", async () => {
    const res = await login(post("/api/auth/login", { password: PW }, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });
  it("sign out clears the cookie, and only for a same-site request", async () => {
    const ok = await logout(post("/api/auth/logout", {}));
    expect(ok.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await logout(post("/api/auth/logout", {}, { origin: "https://evil.example" }))).status).toBe(403);
  });
});

describe("CSRF on state-changing admin requests", () => {
  async function session() {
    const res = await login(post("/api/auth/login", { password: PW }));
    const cookie = cookieOf(res);
    const { csrfToken, verifySession } = await import("./session");
    const s = (await verifySession(process.env, cookie.split("=")[1]))!;
    return { cookie, token: await csrfToken(process.env, s.sid) };
  }
  it("rejects a cross-site origin even with a valid session", async () => {
    const { cookie, token } = await session();
    const res = await purge(post("/api/purge", {}, { cookie, "x-reveal-csrf": token, origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });
  it("rejects a same-origin request without the token, or with someone else's", async () => {
    const { cookie } = await session();
    expect((await purge(post("/api/purge", {}, { cookie }))).status).toBe(403);
    expect((await purge(post("/api/purge", {}, { cookie, "x-reveal-csrf": "AAAA" }))).status).toBe(403);
  });
  it("accepts a same-origin request with the session token", async () => {
    const { cookie, token } = await session();
    const res = await purge(post("/api/purge", {}, { cookie, "x-reveal-csrf": token }));
    expect(res.status).toBe(200);
  });
  it("a request with no Origin and no fetch metadata is refused", async () => {
    const { cookie, token } = await session();
    const res = await purge(new Request("http://localhost:3000/api/purge", { method: "POST", headers: { host: H.host, cookie, "x-reveal-csrf": token } }));
    expect(res.status).toBe(403);
  });
  it("settings refuse person-level when no admin auth is set", async () => {
    const { cookie, token } = await session();
    const body = { personLevel: { enabled: true, acknowledgedTerms: "2026-10-11", acknowledgedConditions: ["privacy_notice", "opt_out_link", "honour_gpc", "supplier_contract", "legal_review"] } };
    const ok = await putSettings(new Request("http://localhost:3000/api/settings", { method: "PUT", headers: { ...H, cookie, "x-reveal-csrf": token }, body: JSON.stringify(body) }));
    expect(ok.status).toBe(200);
    await expect(updateConfigForTest(body, {})).rejects.toThrow(/admin sign-in/);
  });
});
