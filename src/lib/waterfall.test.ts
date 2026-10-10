import { describe, expect, it, vi } from "vitest";
import { ConfigSchema, DEFAULT_CONFIG, DEFAULT_PROVIDERS, parseConfig, type RevealConfig } from "./config";
import { resolveIps, type EngineInput } from "./engine";
import { inCidr } from "./ip";
import type { LoootRun, LoootRunner } from "./looot";
import { buildQuote } from "./quote";
import { lookupKey } from "./waterfall";

const NOW = new Date("2026-10-10T12:00:00Z");
const IP = "203.0.113.7";

const ipinfo = (name: string, domain: string, type?: string, extra: Record<string, unknown> = {}) => ({ company: { name, domain, ...(type ? { type } : {}) }, asn: { asn: "AS1", name, domain, ...(type ? { type } : {}) }, country: "US", ...extra });
const lite = (name: string, domain: string) => ({ asn: "AS1", as_name: name, as_domain: domain, country_code: "US" });
const pdl = (name: string, website: string) => ({ status: 200, data: { company: { name, website } } });

type Replies = Record<string, Partial<LoootRun> | ((input: Record<string, unknown>) => Partial<LoootRun>)>;
/** A mock looot that answers per endpoint id and records every call in order. */
function mock(replies: Replies) {
  const calls: { endpointId: string; key: string }[] = [];
  const looot: LoootRunner = {
    runAndWait: vi.fn(async (endpointId, input, key) => {
      calls.push({ endpointId, key });
      const r = replies[endpointId];
      const body = typeof r === "function" ? r(input) : r;
      return { runId: "r", status: "completed", actualCost: 0, ...(body ?? { status: "failed", error: { code: "not_found", message: "404" } }) } as LoootRun;
    }),
  };
  return { looot, calls, order: () => calls.map((c) => c.endpointId) };
}

function cfg(over: { enabled?: string[]; order?: string[]; crossCheck?: boolean; cacheDays?: number; skipCidrs?: string[]; enrich?: boolean } = {}): RevealConfig {
  const on = over.enabled ?? ["ipinfo-lite", "ipinfo", "people-data-labs"];
  const byId = new Map(DEFAULT_PROVIDERS.map((p) => [p.id, p]));
  const ids = over.order ?? DEFAULT_PROVIDERS.map((p) => p.id);
  return ConfigSchema.parse({ ...DEFAULT_CONFIG, enrich: over.enrich ?? false, waterfall: { providers: ids.map((id) => ({ ...byId.get(id)!, enabled: on.includes(id) })), crossCheck: over.crossCheck ?? false, cacheDays: over.cacheDays ?? 30, skipCidrs: over.skipCidrs ?? [] } });
}
const run = (looot: LoootRunner, config: RevealConfig, over: Partial<EngineInput> = {}) => resolveIps({ ips: [IP], looot, config, cache: {}, companies: {}, capMicros: 1_000_000, now: NOW, ...over });

describe("waterfall order", () => {
  it("calls providers in the configured order and stops at the first confident match", async () => {
    const m = mock({ "ipinfo-lite": { result: lite("Acme", "acme.example") }, "ipinfo--2": { result: ipinfo("Acme", "acme.example", "business"), actualCost: 0.0005 }, "people-data-labs-ip-enrich": { result: pdl("Acme", "acme.example"), actualCost: 0.28 } });
    const out = await run(m.looot, cfg());
    expect(m.order()).toEqual(["ipinfo-lite", "ipinfo--2"]);
    expect(out.resolutions[IP]).toMatchObject({ status: "company", domain: "acme.example", lookupProvider: "ipinfo", confidence: "high" });
    expect(out.resolutions[IP].answers?.map((a) => [a.provider, a.outcome])).toEqual([["ipinfo-lite", "weak"], ["ipinfo", "match"]]);
    expect(out.spentMicros).toBe(500);
  });
  it("follows a reordered list", async () => {
    const m = mock({ "ipinfo--2": { result: ipinfo("Acme", "acme.example", "business"), actualCost: 0.0005 }, "ipinfo-lite": { result: lite("Acme", "acme.example") } });
    await run(m.looot, cfg({ order: ["ipinfo", "ipinfo-lite", "people-data-labs"] }));
    expect(m.order()).toEqual(["ipinfo--2"]);
  });
  it("never calls a disabled provider", async () => {
    const m = mock({ "ipinfo--2": { result: ipinfo("Acme", "acme.example") }, "people-data-labs-ip-enrich": { result: pdl("Acme", "acme.example"), actualCost: 0.28 } });
    await run(m.looot, cfg({ enabled: ["ipinfo", "people-data-labs"] }));
    expect(m.order()).toEqual(["ipinfo--2", "people-data-labs-ip-enrich"]);
    const m2 = mock({});
    await run(m2.looot, cfg({ enabled: [] }));
    expect(m2.calls).toHaveLength(0);
  });
  it("moves on when a provider fails or finds nothing, and records who answered", async () => {
    const m = mock({ "ipinfo--2": { status: "failed", error: { code: "x", message: "boom" } }, "people-data-labs-ip-enrich": { result: pdl("Acme", "https://www.acme.example/about"), actualCost: 0.28 } });
    const out = await run(m.looot, cfg({ enabled: ["ipinfo", "people-data-labs"] }));
    expect(out.resolutions[IP]).toMatchObject({ status: "company", domain: "acme.example", lookupProvider: "people-data-labs", confidence: "high", costMicros: 280_000 });
    expect(out.calls.map((c) => [c.providerId, c.costMicros])).toEqual([["ipinfo", 0], ["people-data-labs", 280_000]]);
  });
  it("sends one stable idempotency key per provider and IP", async () => {
    const m = mock({ "ipinfo--2": { result: ipinfo("Acme", "acme.example", "business") } });
    await run(m.looot, cfg({ enabled: ["ipinfo"] }));
    expect(m.calls[0].key).toBe(lookupKey("ipinfo", IP));
  });
});

describe("ISP, mobile, hosting and VPN filter", () => {
  it("stops at an ISP verdict from the first provider and spends nothing more", async () => {
    const m = mock({ "ipinfo-lite": { result: lite("Example Broadband", "examplebroadband.example") }, "ipinfo--2": { result: ipinfo("x", "x.example", "business"), actualCost: 0.0005 } });
    const out = await run(m.looot, cfg(), { config: cfg({ enrich: true }) });
    expect(m.order()).toEqual(["ipinfo-lite"]);
    expect(out.resolutions[IP]).toMatchObject({ status: "excluded", reason: "isp", lookupProvider: "ipinfo-lite" });
    expect(out.spentMicros).toBe(0);
  });
  it.each([
    ["isp", ipinfo("Home Net", "homenet.example", "isp")],
    ["hosting", ipinfo("Rackco", "rackco.example", "hosting")],
    ["vpn", ipinfo("Acme", "acme.example", "business", { privacy: { vpn: true } })],
    ["mobile", ipinfo("Acme Wireless", "acmew.example", "business", { carrier: { name: "Acme", mcc: "310", mnc: "410" } })],
  ])("excludes %s and does not call the company-level provider or enrichment", async (reason, body) => {
    const m = mock({ "ipinfo--2": { result: body, actualCost: 0.0005 }, "people-data-labs-ip-enrich": { result: pdl("A", "a.example"), actualCost: 0.28 } });
    const out = await run(m.looot, cfg({ enabled: ["ipinfo", "people-data-labs"], enrich: true }));
    expect(m.order()).toEqual(["ipinfo--2"]);
    expect(out.resolutions[IP]).toMatchObject({ status: "excluded", reason });
    expect(out.spentMicros).toBe(500);
  });
  it("also lets a later provider exclude a range, for example PDL metadata saying hosting", async () => {
    const m = mock({ "ipinfo--2": { result: ipinfo("Tandem", "tandem.example") }, "people-data-labs-ip-enrich": { result: { data: { ip: { metadata: { hosting: true } }, company: { name: "Tandem", website: "tandem.example" } } }, actualCost: 0.28 } });
    const out = await run(m.looot, cfg({ enabled: ["ipinfo", "people-data-labs"] }));
    expect(out.resolutions[IP]).toMatchObject({ status: "excluded", reason: "hosting" });
  });
  it("skips private addresses and configured ranges without any call", async () => {
    const m = mock({});
    const out = await run(m.looot, cfg({ skipCidrs: ["203.0.113.0/24"] }), { ips: [IP, "10.0.0.4", "198.51.100.9"] });
    expect(m.calls.map((c) => c.key).filter((k) => k.includes(IP))).toEqual([]);
    expect(out.resolutions[IP]).toMatchObject({ status: "excluded", reason: "skipped_range", costMicros: 0 });
    expect(out.resolutions["10.0.0.4"]).toMatchObject({ reason: "private_ip" });
  });
  it("matches CIDR ranges", () => {
    expect(inCidr("203.0.113.200", "203.0.113.0/24")).toBe(true);
    expect(inCidr("203.0.114.1", "203.0.113.0/24")).toBe(false);
    expect(inCidr("2001:db8::1", "203.0.113.0/24")).toBe(false);
  });
});

describe("cache", () => {
  const answered = (age: number) => ({ [IP]: { status: "company" as const, domain: "acme.example", name: "Acme", costMicros: 500, resolvedAt: new Date(NOW.getTime() - age * 86_400_000).toISOString() } });
  it("reuses an answer inside the window with no call", async () => {
    const m = mock({ "ipinfo--2": { result: ipinfo("Acme", "acme.example", "business") } });
    const out = await run(m.looot, cfg({ cacheDays: 30 }), { cache: answered(10) });
    expect(m.calls).toHaveLength(0);
    expect(out.resolutions[IP].domain).toBe("acme.example");
  });
  it("looks an IP up again, under a new key, once the window has passed", async () => {
    const m = mock({ "ipinfo--2": { result: ipinfo("Newco", "newco.example", "business"), actualCost: 0.0005 } });
    const out = await run(m.looot, cfg({ cacheDays: 30, enabled: ["ipinfo"] }), { cache: answered(31) });
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0].key).not.toBe(lookupKey("ipinfo", IP));
    expect(out.resolutions[IP].domain).toBe("newco.example");
  });
  it("cacheDays 0 looks up on every run, and a quote counts only fresh answers as free", () => {
    const c0 = cfg({ cacheDays: 0 });
    expect(buildQuote([IP], answered(0), c0, 1_000_000, new Date(NOW.getTime() + 1000)).cachedIps).toBe(0);
    expect(buildQuote([IP], answered(10), cfg({ cacheDays: 30 }), 1_000_000, NOW).cachedIps).toBe(1);
    expect(buildQuote([IP], answered(31), cfg({ cacheDays: 30 }), 1_000_000, NOW).cachedIps).toBe(0);
  });
  it("looks a repeated IP up once in one run", async () => {
    const m = mock({ "ipinfo--2": { result: ipinfo("Acme", "acme.example", "business") } });
    await run(m.looot, cfg({ enabled: ["ipinfo"] }), { ips: [IP, IP, IP] });
    expect(m.calls).toHaveLength(1);
  });
});

describe("disagreement", () => {
  it("shows both companies and marks the result low confidence", async () => {
    const m = mock({ "ipinfo--2": { result: ipinfo("Tandem Networks", "tandemnet.example") }, "people-data-labs-ip-enrich": { result: pdl("Marlow & Pike", "marlowpike.example"), actualCost: 0.28 } });
    const out = await run(m.looot, cfg({ enabled: ["ipinfo", "people-data-labs"] }));
    const r = out.resolutions[IP];
    expect(r).toMatchObject({ status: "company", confidence: "low", domain: "marlowpike.example", lookupProvider: "people-data-labs" });
    expect(r.alternatives).toEqual([{ provider: "ipinfo", name: "Tandem Networks", domain: "tandemnet.example" }]);
  });
  it("with crossCheck, asks one more company-level provider after a confident match and flags a mismatch", async () => {
    const m = mock({ "ipinfo--2": { result: ipinfo("Acme", "acme.example", "business"), actualCost: 0.0005 }, "people-data-labs-ip-enrich": { result: pdl("Other Inc", "other.example"), actualCost: 0.28 } });
    const out = await run(m.looot, cfg({ crossCheck: true }));
    expect(m.order()).toEqual(["ipinfo-lite", "ipinfo--2", "people-data-labs-ip-enrich"]);
    expect(out.resolutions[IP]).toMatchObject({ confidence: "low", domain: "acme.example" });
  });
  it("agreeing providers, including a subdomain, stay high", async () => {
    const m = mock({ "ipinfo--2": { result: ipinfo("Acme", "acme.example", "business"), actualCost: 0.0005 }, "people-data-labs-ip-enrich": { result: pdl("Acme", "https://eu.acme.example"), actualCost: 0.28 } });
    const out = await run(m.looot, cfg({ crossCheck: true }));
    expect(out.resolutions[IP]).toMatchObject({ confidence: "high" });
    expect(out.resolutions[IP].alternatives).toBeUndefined();
  });
  it("an ASN owner that differs from the company does not count as a disagreement", async () => {
    const m = mock({ "ipinfo-lite": { result: lite("Big Carrier", "bigcarrier.example") }, "ipinfo--2": { result: ipinfo("Acme", "acme.example", "business"), actualCost: 0.0005 } });
    const out = await run(m.looot, cfg());
    expect(out.resolutions[IP]).toMatchObject({ confidence: "high", domain: "acme.example" });
  });
  it("a weak answer on its own is medium confidence", async () => {
    const m = mock({ "ipinfo-lite": { result: lite("Smallco", "smallco.example") } });
    const out = await run(m.looot, cfg({ enabled: ["ipinfo-lite"] }));
    expect(out.resolutions[IP]).toMatchObject({ status: "company", confidence: "medium" });
  });
});

describe("spend cap", () => {
  it("never makes a call that would pass the cap, even with parallel lookups", async () => {
    const m = mock({ "ipinfo--2": { result: ipinfo("Acme", "acme.example", "business"), actualCost: 0.0005 } });
    const ips = Array.from({ length: 12 }, (_, n) => `203.0.113.${n + 1}`);
    const out = await run(m.looot, cfg({ enabled: ["ipinfo"] }), { ips, capMicros: 2500 });
    expect(m.calls).toHaveLength(5);
    expect(out.spentMicros).toBe(2500);
    expect(out.notRun.ips).toHaveLength(7);
    expect(Object.values(out.resolutions).filter((r) => r.status === "company")).toHaveLength(5);
  });
  it("does not start a $0.28 provider on a $0.01 cap, but still uses the free ones", async () => {
    const m = mock({ "ipinfo-lite": { result: lite("Smallco", "smallco.example") }, "people-data-labs-ip-enrich": { result: pdl("A", "a.example"), actualCost: 0.28 } });
    const out = await run(m.looot, cfg({ enabled: ["ipinfo-lite", "people-data-labs"] }), { capMicros: 10_000 });
    expect(m.order()).toEqual(["ipinfo-lite"]);
    expect(out.resolutions[IP].status).toBe("pending");
    expect(out.notRun.ips).toEqual([IP]);
    expect(out.spentMicros).toBe(0);
  });
  it("enrichment also stops at the cap", async () => {
    const m = mock({ "ipinfo--2": { result: ipinfo("Acme", "acme.example", "business"), actualCost: 0.0005 }, "job:company.enrich": { result: { name: "Acme" }, actualCost: 0.0019 } });
    const out = await run(m.looot, cfg({ enabled: ["ipinfo"], enrich: true }), { capMicros: 1000 });
    expect(out.spentMicros).toBe(500);
    expect(out.notRun.domains).toEqual(["acme.example"]);
  });
});

describe("quote", () => {
  it("prices the whole waterfall worst case, in order, and flags a cap that binds", () => {
    const q = buildQuote(["203.0.113.1", "203.0.113.2", "10.0.0.1"], {}, cfg({ enrich: true, enabled: ["ipinfo-lite", "ipinfo"] }), 1000, NOW);
    expect(q.order.map((p) => p.id)).toEqual(["ipinfo-lite", "ipinfo"]);
    expect(q.lines.map((l) => [l.providerId ?? l.jobId, l.calls, l.priceMicros])).toEqual([["ipinfo-lite", 2, 0], ["ipinfo", 2, 500], ["company.enrich", 2, 1900]]);
    expect(q.maxMicros).toBe(2 * 500 + 2 * 1900);
    expect(q.capBinds).toBe(true);
    expect(buildQuote(["203.0.113.1"], {}, cfg({ enabled: ["ipinfo", "people-data-labs"] }), 1_000_000, NOW).maxMicros).toBe(500 + 280_000);
  });
});

describe("config", () => {
  it("upgrades an old lookup field and rejects duplicate provider ids or a bad range", () => {
    expect(parseConfig(JSON.stringify({ lookup: "ipinfo-lite" })).waterfall.providers.filter((p) => p.enabled).map((p) => p.id)).toEqual(["ipinfo-lite"]);
    expect(parseConfig(JSON.stringify({ lookup: "ipinfo" })).waterfall.providers.filter((p) => p.enabled).map((p) => p.id)).toEqual(["ipinfo-lite", "ipinfo"]);
    expect(() => ConfigSchema.parse({ waterfall: { providers: [DEFAULT_PROVIDERS[0], DEFAULT_PROVIDERS[0]] } })).toThrow();
    expect(() => ConfigSchema.parse({ waterfall: { skipCidrs: ["nope"] } })).toThrow();
  });
});
