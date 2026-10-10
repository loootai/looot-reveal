import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, ConfigSchema } from "./config";
import { classify, enrichKey, resolveIps, type EngineInput } from "./engine";
import { lookupKey } from "./waterfall";
import type { LoootRun, LoootRunner } from "./looot";
import { parseIpInfo } from "./parse";

const NOW = new Date("2026-10-10T12:00:00Z");
const ipBody = (name: string, domain: string, type: string, privacy: Record<string, boolean> = {}) => ({ company: { name, domain, type }, asn: { asn: "AS1", name, domain, type }, country: "US", privacy });

function runner(fn: (endpointId: string, input: Record<string, unknown>) => Partial<LoootRun>): LoootRunner & { calls: [string, Record<string, unknown>, string, unknown][] } {
  const calls: [string, Record<string, unknown>, string, unknown][] = [];
  return {
    calls,
    runAndWait: vi.fn(async (e, i, k, o) => {
      calls.push([e, i, k, o]);
      return { runId: "r", status: "completed", actualCost: 0, ...fn(e, i) } as LoootRun;
    }),
  };
}

/** The old single-provider setup: IPinfo full only. The waterfall tests live in waterfall.test.ts. */
const FULL_ONLY = ConfigSchema.parse({ ...DEFAULT_CONFIG, waterfall: { providers: DEFAULT_CONFIG.waterfall.providers.map((p) => ({ ...p, enabled: p.id === "ipinfo" })) } });
const base = (looot: LoootRunner, over: Partial<EngineInput> = {}): EngineInput => ({ ips: [], looot, config: FULL_ONLY, cache: {}, companies: {}, capMicros: 1_000_000, now: NOW, ...over });

describe("resolveIps", () => {
  it("looks up each unique IP once and enriches each company domain once", async () => {
    const looot = runner((e, i) => (e === "ipinfo--2" ? { result: ipBody("Acme", "acme.example", "business"), actualCost: 0.0005 } : { result: { name: "Acme", industry: "Software", employee_count: 50 }, actualCost: 0.0019, ...(i ? {} : {}) }));
    const out = await resolveIps(base(looot, { ips: ["203.0.113.1", "203.0.113.2", "203.0.113.1"] }));
    const lookups = looot.calls.filter((c) => c[0] === "ipinfo--2");
    const enrich = looot.calls.filter((c) => c[0] === "job:company.enrich");
    expect(lookups).toHaveLength(2);
    expect(enrich).toHaveLength(1);
    expect(enrich[0][3]).toEqual({ fallback: true });
    expect(out.spentMicros).toBe(500 + 500 + 1900);
    expect(out.resolutions["203.0.113.1"]).toMatchObject({ status: "company", domain: "acme.example" });
    expect(out.companies["acme.example"]).toMatchObject({ status: "done", profile: { industry: "Software", employees: 50 } });
  });

  it("sends a stable idempotency key per input and job", async () => {
    const looot = runner(() => ({ result: ipBody("Acme", "acme.example", "business") }));
    await resolveIps(base(looot, { ips: ["203.0.113.1"] }));
    expect(looot.calls[0][2]).toBe(lookupKey("ipinfo", "203.0.113.1"));
    expect(looot.calls[1][2]).toBe(enrichKey("acme.example"));
    expect(lookupKey("ipinfo", "203.0.113.1")).toBe(lookupKey("ipinfo", "203.0.113.1"));
  });

  it("skips private IPs without a call and never re-looks-up a cached answer", async () => {
    const looot = runner(() => ({ result: ipBody("Acme", "acme.example", "business") }));
    const cache = { "203.0.113.9": { status: "company" as const, domain: "acme.example", name: "Acme", costMicros: 500, resolvedAt: NOW.toISOString() } };
    const out = await resolveIps(base(looot, { ips: ["10.1.2.3", "203.0.113.9"], cache, config: ConfigSchema.parse({ enrich: false, waterfall: FULL_ONLY.waterfall }) }));
    expect(looot.calls).toHaveLength(0);
    expect(out.resolutions["10.1.2.3"]).toMatchObject({ status: "excluded", reason: "private_ip" });
  });

  it("drops ISPs, hosting and VPNs before any enrichment call", async () => {
    const looot = runner((_e, i) => {
      const ip = String(i.ip);
      if (ip.endsWith(".1")) return { result: ipBody("Home Net", "homenet.example", "isp") };
      if (ip.endsWith(".2")) return { result: ipBody("Cloud", "cloud.example", "hosting") };
      return { result: ipBody("Relay", "relay.example", "business", { vpn: true }) };
    });
    const out = await resolveIps(base(looot, { ips: ["203.0.113.1", "203.0.113.2", "203.0.113.3"] }));
    expect(looot.calls.every((c) => c[0] === "ipinfo--2")).toBe(true);
    expect(["203.0.113.1", "203.0.113.2", "203.0.113.3"].map((ip) => out.resolutions[ip].reason)).toEqual(["isp", "hosting", "vpn"]);
  });

  it("stops before a call that would pass the cap", async () => {
    const looot = runner(() => ({ result: ipBody("Acme", "acme.example", "business"), actualCost: 0.0005 }));
    const ips = Array.from({ length: 12 }, (_, n) => `203.0.113.${n + 1}`);
    const out = await resolveIps(base(looot, { ips, capMicros: 3000, config: ConfigSchema.parse({ enrich: false, waterfall: FULL_ONLY.waterfall }) }));
    expect(looot.calls).toHaveLength(6);
    expect(out.spentMicros).toBe(3000);
    expect(out.notRun.ips).toHaveLength(6);
  });

  it("stores a run that is still in progress as pending, not failed, and charges nothing", async () => {
    const looot = runner(() => ({ status: "pending_provider", actualCost: 0 }));
    const out = await resolveIps(base(looot, { ips: ["203.0.113.1"] }));
    expect(out.resolutions["203.0.113.1"].status).toBe("pending");
    expect(out.spentMicros).toBe(0);
  });

  it("marks a failed lookup as failed and retries it on the next run with the same key", async () => {
    const looot = runner(() => ({ status: "failed", error: { code: "x", message: "boom" } }));
    const first = await resolveIps(base(looot, { ips: ["203.0.113.1"] }));
    expect(first.resolutions["203.0.113.1"]).toMatchObject({ status: "failed", reason: "lookup_failed" });
    await resolveIps(base(looot, { ips: ["203.0.113.1"], cache: first.resolutions }));
    expect(looot.calls.map((c) => c[2])).toEqual([lookupKey("ipinfo", "203.0.113.1"), lookupKey("ipinfo", "203.0.113.1")]);
  });

  it("turns a thrown request error into a failed lookup instead of crashing the run", async () => {
    const looot: LoootRunner = { runAndWait: async () => { throw new Error("network down"); } };
    const out = await resolveIps(base(looot, { ips: ["203.0.113.1"] }));
    expect(out.resolutions["203.0.113.1"].status).toBe("failed");
  });
});

describe("classify", () => {
  it("uses the network name hints when the provider gives no type", () => {
    expect(classify(parseIpInfo("1.1.1.1", { org: "AS7922 Comcast Cable Communications" }), DEFAULT_CONFIG).reason).toBe("isp");
    expect(classify(parseIpInfo("1.1.1.1", { asn: { asn: "AS1", name: "Smallco", domain: "smallco.example" } }), DEFAULT_CONFIG).reason).toBeUndefined();
    expect(classify(parseIpInfo("1.1.1.1", { org: "AS1 Smallco" }), DEFAULT_CONFIG).reason).toBe("no_domain");
  });
});
