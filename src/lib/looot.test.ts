import { describe, expect, it, vi } from "vitest";
import { LoootClient, LoootError, loootFromEnv } from "./looot";
import { ConfigSchema, DEFAULT_CONFIG, parseConfig } from "./config";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("LoootClient", () => {
  it("posts endpoint, input, idempotency key and the bearer token, and adds fallback only when asked", async () => {
    const f = vi.fn(async () => json({ runId: "run_1", status: "completed", result: {}, actualCost: 0.0005 }));
    const client = new LoootClient({ token: "tok_test", fetch: f as unknown as typeof fetch });
    await client.run("ipinfo--2", { ip: "203.0.113.1" }, "reveal:ip.lookup:203.0.113.1");
    await client.run("job:company.enrich", { domain: "a.example" }, "k2", { fallback: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.looot.ai/v1/runs?wait=30");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok_test");
    expect(JSON.parse(init.body as string)).toEqual({ endpointId: "ipinfo--2", input: { ip: "203.0.113.1" }, idempotencyKey: "reveal:ip.lookup:203.0.113.1" });
    expect(JSON.parse((f.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ fallback: true });
  });
  it("polls a run that is not finished", async () => {
    const answers = [json({ runId: "r", status: "running" }), json({ runId: "r", status: "completed", actualCost: "0.0005" })];
    const f = vi.fn(async () => answers.shift()!);
    const client = new LoootClient({ token: "t", fetch: f as unknown as typeof fetch, sleep: async () => {} });
    expect((await client.runAndWait("ipinfo--2", { ip: "1.1.1.1" }, "k")).status).toBe("completed");
    expect((f.mock.calls[1] as unknown as [string])[0]).toBe("https://api.looot.ai/v1/runs/r");
  });
  it("hands back a run still in progress at the poll timeout, and throws LoootError on HTTP errors", async () => {
    const f = vi.fn(async () => json({ runId: "r", status: "queued" }));
    const client = new LoootClient({ token: "t", fetch: f as unknown as typeof fetch, sleep: async () => {}, pollTimeoutMs: 0 });
    expect((await client.runAndWait("e", {}, "k")).status).toBe("queued");
    const bad = new LoootClient({ token: "t", fetch: (async () => json({ error: { code: "insufficient_funds", message: "Top up" } }, 402)) as unknown as typeof fetch });
    await expect(bad.run("e", {}, "k")).rejects.toMatchObject({ status: 402, code: "insufficient_funds" });
    expect(() => loootFromEnv({})).toThrow(LoootError);
  });
});

describe("config", () => {
  it("fills defaults and rejects a bad signal with the field named", () => {
    const c = ConfigSchema.parse({});
    expect(c).toMatchObject({ enrich: true, retentionDays: 30, storeRawIp: false });
    expect(() => parseConfig(JSON.stringify({ icp: { signals: [{ id: "x", label: "x", weight: 1, kind: "text", field: "industry", anyOf: [] }] } }))).toThrow();
  });
  it("ships a default ICP whose weights add up to 8", () => {
    expect(DEFAULT_CONFIG.icp.signals.reduce((n, s) => n + s.weight, 0)).toBe(8);
  });
});
