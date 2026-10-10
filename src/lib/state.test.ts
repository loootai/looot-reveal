import { describe, expect, it } from "vitest";
import { ConfigSchema, DEFAULT_CONFIG } from "./config";
import { buildFeed } from "./feed";
import { buildQuote } from "./quote";
import { addVisits, emptyState, ipKeyOf, purgeOld, quotePending, resolvePending } from "./state";
import type { LoootRunner } from "./looot";

/** IPinfo full only, the setup these older tests were written for. */
const FULL_ONLY = ConfigSchema.parse({ ...DEFAULT_CONFIG, waterfall: { providers: DEFAULT_CONFIG.waterfall.providers.map((p) => ({ ...p, enabled: p.id === "ipinfo" })) } });
const NOW = new Date("2026-10-10T12:00:00Z");
const looot: LoootRunner = {
  runAndWait: async (e) =>
    e === "ipinfo--2"
      ? { runId: "r", status: "completed", actualCost: 0.0005, result: { company: { name: "Acme", domain: "acme.example", type: "business" }, country: "US" } }
      : { runId: "r", status: "completed", actualCost: 0.0019, result: { name: "Acme", industry: "Software", employee_count: 60, country: "US" } },
};
const v = (ip: string, path: string, ts = "2026-10-10T10:00:00.000Z") => ({ ip, path, ts });

describe("state", () => {
  it("stores a salted hash instead of the IP and drops the raw IP once resolved", async () => {
    const s = emptyState();
    addVisits(s, [v("203.0.113.1", "/pricing"), v("203.0.113.1", "/")], FULL_ONLY);
    expect(Object.values(s.pendingIps)).toEqual(["203.0.113.1"]);
    await resolvePending(s, FULL_ONLY, looot, 1_000_000, NOW);
    expect(s.pendingIps).toEqual({});
    expect(JSON.stringify(s)).not.toContain("203.0.113.1");
    expect(s.visits[0].ipKey).toBe(ipKeyOf("203.0.113.1", s, FULL_ONLY));
  });
  it("keeps the raw IP when storeRawIp is on", () => {
    const s = emptyState();
    const c = ConfigSchema.parse({ storeRawIp: true });
    addVisits(s, [v("203.0.113.1", "/")], c);
    expect(s.visits[0].ipKey).toBe("203.0.113.1");
  });
  it("builds a feed with pages, counts and an ICP flag", async () => {
    const s = emptyState();
    addVisits(s, [v("203.0.113.1", "/pricing"), v("203.0.113.1", "/pricing", "2026-10-10T11:00:00.000Z"), v("203.0.113.1", "/docs")], FULL_ONLY);
    await resolvePending(s, FULL_ONLY, looot, 1_000_000, NOW);
    const feed = buildFeed(s.visits, s.resolutions, s.companies, FULL_ONLY);
    expect(feed.companies).toHaveLength(1);
    expect(feed.companies[0]).toMatchObject({ domain: "acme.example", visits: 3, uniqueIps: 1, lastSeen: "2026-10-10T11:00:00.000Z", costMicros: 2400 });
    expect(feed.companies[0].pages[0]).toEqual({ path: "/pricing", views: 2 });
    expect(feed.companies[0].icp.matched).toBe(true);
  });
  it("ignores paths in ignorePaths", async () => {
    const s = emptyState();
    addVisits(s, [v("203.0.113.1", "/api/x"), v("203.0.113.1", "/docs")], FULL_ONLY);
    await resolvePending(s, FULL_ONLY, looot, 1_000_000, NOW);
    expect(buildFeed(s.visits, s.resolutions, s.companies, FULL_ONLY).totalVisits).toBe(1);
  });
  it("purges visits past the retention window, then resolutions and companies nobody points at", async () => {
    const s = emptyState();
    addVisits(s, [v("203.0.113.1", "/", "2026-08-01T00:00:00.000Z")], FULL_ONLY);
    await resolvePending(s, FULL_ONLY, looot, 1_000_000, NOW);
    const r = purgeOld(s, FULL_ONLY, NOW);
    expect(r.visits).toBe(1);
    expect(s.resolutions).toEqual({});
    expect(s.companies).toEqual({});
  });
});

describe("buildQuote", () => {
  it("counts new public IPs, prices both jobs and flags a cap that binds", () => {
    const q = buildQuote(["203.0.113.1", "203.0.113.2", "10.0.0.1", "203.0.113.1"], {}, DEFAULT_CONFIG, 3000, NOW);
    expect(q).toMatchObject({ uniqueIps: 3, privateIps: 1, cachedIps: 0, maxMicros: 2 * 500 + 2 * 1900, capBinds: true });
    expect(q.lines.map((l) => l.providerId ?? l.jobId)).toEqual(["ipinfo-lite", "ipinfo", "company.enrich"]);
  });
  it("is free for answered IPs and cheaper with the free lookup and no enrichment", () => {
    const answered = { "203.0.113.1": { status: "company" as const, costMicros: 0, resolvedAt: NOW.toISOString() } };
    expect(buildQuote(["203.0.113.1"], answered, DEFAULT_CONFIG, 1_000_000, NOW).maxMicros).toBe(0);
    expect(buildQuote(["203.0.113.2"], {}, ConfigSchema.parse({ enrich: false, waterfall: { providers: DEFAULT_CONFIG.waterfall.providers.map((p) => ({ ...p, enabled: p.id === "ipinfo-lite" })) } }), 1_000_000, NOW).maxMicros).toBe(0);
  });
  it("quotes pending IPs from the state", () => {
    const s = emptyState();
    addVisits(s, [v("203.0.113.1", "/")], FULL_ONLY, NOW);
    expect(quotePending(s, FULL_ONLY, 1_000_000, NOW).maxMicros).toBe(2400);
  });
});
