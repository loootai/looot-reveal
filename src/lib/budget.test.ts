import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Budget, DEFAULT_LIMITS, HARD_EXPIRY_MS, RESERVE_TTL_MS, ledgerKey } from "./budget";
import { ConfigSchema, DEFAULT_CONFIG, DEFAULT_PROVIDERS, type RevealConfig } from "./config";
import { resolveIps, type EngineInput } from "./engine";
import { LoootError, type LoootRun, type LoootRunner } from "./looot";
import { lookupKey, refreshSalt } from "./waterfall";

const now = new Date("2026-10-10T09:00:00Z");
const IP = "203.0.113.7";
let dir: string;
let file: string;
const open = () => new Budget(file);

beforeEach(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  dir = mkdtempSync(join(process.cwd(), ".vitest", "budget-"));
  file = join(dir, "budget.json");
});

/** One provider, $0.0005 a call, so a budget in micros maps to a number of lookups. */
const config = (cacheDays = 30): RevealConfig => {
  const p = { ...DEFAULT_PROVIDERS.find((x) => x.id === "ipinfo")!, enabled: true };
  return ConfigSchema.parse({ ...DEFAULT_CONFIG, enrich: false, waterfall: { providers: [p], crossCheck: false, cacheDays, skipCidrs: [] } });
};
const PRICE = 500;
const body = { company: { name: "Acme", domain: "acme.example", type: "business" }, asn: { asn: "AS1", name: "Acme", domain: "acme.example", type: "business" }, country: "US" };
const completed = (cost = 0.0005): LoootRun => ({ runId: "run_ok", status: "completed", result: body, actualCost: cost });

/** A fake looot that charges once per idempotency key, like the real one: a replay returns the stored run and costs nothing. */
function fake(answer: (key: string) => LoootRun | Promise<LoootRun> = () => completed()) {
  const charged = new Map<string, number>();
  const calls: string[] = [];
  const looot: LoootRunner = {
    async runAndWait(_e, _i, key) {
      calls.push(key);
      const run = await answer(key);
      if (run.status === "completed" && !charged.has(key)) charged.set(key, Number(run.actualCost ?? 0));
      return run;
    },
  };
  return { looot, calls, chargedMicros: () => [...charged.values()].reduce((n, v) => n + Math.round(v * 1_000_000), 0) };
}
const ips = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `203.0.113.${from + i}`);
const run = (looot: LoootRunner, over: Partial<EngineInput> = {}) => resolveIps({ ips: [IP], looot, config: config(), cache: {}, companies: {}, capMicros: 10_000_000, now, ...over });

describe("period budget", () => {
  it("has a default daily and monthly limit that the owner can change", async () => {
    const b = open();
    expect((await b.status(now)).limits).toEqual(DEFAULT_LIMITS);
    await b.setLimits({ dailyMicros: 2_000_000, monthlyMicros: 9_000_000 });
    expect((await open().status(now)).limits).toEqual({ dailyMicros: 2_000_000, monthlyMicros: 9_000_000 });
  });

  it("lets exactly one of two concurrent reservations through when their sum is over the budget", async () => {
    await open().setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    const out = await Promise.all([open().reserve("k1", 700_000, now), open().reserve("k2", 700_000, now)]);
    expect(out.filter((r) => r.ok)).toHaveLength(1);
    expect((await open().status(now)).day.reservedMicros).toBe(700_000);
  });

  it("holds under 25 concurrent reservations from separate handles", async () => {
    await open().setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    const out = await Promise.all(Array.from({ length: 25 }, (_, i) => open().reserve(`k${i}`, 100_000, now)));
    expect(out.filter((r) => r.ok)).toHaveLength(10);
    const s = await open().status(now);
    expect(s.day.reservedMicros).toBe(1_000_000);
    expect(s.day.remainingMicros).toBe(0);
  });

  it("stops many small runs at the budget and says which limit it hit", async () => {
    await open().setLimits({ dailyMicros: 300_000, monthlyMicros: 300_000 });
    const b = open();
    let ok = 0;
    let last = "";
    for (let i = 0; i < 10; i++) {
      const r = await b.reserve(`s${i}`, 100_000, now);
      if (r.ok) ok++;
      else last = r.message;
    }
    expect(ok).toBe(3);
    expect(last).toMatch(/budget is reached/i);
  });

  it("counts a settled run against the day and the month, and a new day starts clean", async () => {
    const b = open();
    await b.setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    await b.reserve("a", 400_000, now);
    await b.settle("a", 350_000, now);
    const s = await b.status(now);
    expect(s.day.usedMicros).toBe(350_000);
    expect(s.month.usedMicros).toBe(350_000);
    const s2 = await b.status(new Date("2026-10-11T09:00:00Z"));
    expect(s2.day.usedMicros).toBe(0);
    expect(s2.month.usedMicros).toBe(350_000);
  });

  it("does not count a key twice when it settles twice", async () => {
    const b = open();
    await b.reserve("a", 400_000, now);
    await b.settle("a", 350_000, now);
    await b.reserve("a", 400_000, now);
    await b.settle("a", 350_000, now);
    expect((await b.status(now)).day.usedMicros).toBe(350_000);
  });

  it("releases a reservation", async () => {
    const b = open();
    await b.reserve("a", 400_000, now);
    await b.release("a");
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("rejects limits that are not positive or put the day above the month", async () => {
    const b = open();
    await expect(b.setLimits({ dailyMicros: 0, monthlyMicros: 1_000_000 })).rejects.toThrow();
    await expect(b.setLimits({ dailyMicros: 5_000_000, monthlyMicros: 1_000_000 })).rejects.toThrow(/daily/i);
    await expect(b.setLimits({ dailyMicros: Number.NaN, monthlyMicros: 1_000_000 })).rejects.toThrow();
  });

  it("survives a damaged file by falling back to the defaults", async () => {
    writeFileSync(file, "{not json");
    expect((await open().status(now)).limits).toEqual(DEFAULT_LIMITS);
  });

  it("never writes a raw key, so an IP in an idempotency key stays out of the file", async () => {
    const b = open();
    const key = lookupKey("ipinfo", IP);
    await b.reserve(ledgerKey(key), 1_000, now);
    await b.settle(ledgerKey(key), 1_000, now);
    expect(readFileSync(file, "utf8")).not.toContain(IP);
  });
});

describe("reconciling reservations", () => {
  async function pendingReservation() {
    const b = open();
    await b.reserve("p", 10_000, now);
    await b.attach("p", "run_p");
    return b;
  }

  it("settles a late completion to the real cost", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "completed", result: { x: 1 }, actualCost: 0.0031 }) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(3_100);
  });

  it("keeps the reservation while the run is still going", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "running" }) }, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(10_000);
    expect(s.day.usedMicros).toBe(0);
  });

  it("releases when the run ended failed with no charge", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "failed", actualCost: 0 }) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(0);
  });

  it("keeps an unfetchable run reserved until the hard expiry, then releases it", async () => {
    const b = await pendingReservation();
    const broken = { getRun: async (): Promise<LoootRun> => { throw new LoootError("down", 503); } };
    await b.reconcile(broken, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    expect((await b.status(now)).day.reservedMicros).toBe(10_000);
    await b.reconcile(broken, new Date(now.getTime() + HARD_EXPIRY_MS + 1));
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("keeps a reservation that never got a run id until the hard expiry", async () => {
    const b = open();
    await b.reserve("crash", 10_000, now);
    const never = { getRun: async (): Promise<LoootRun> => { throw new Error("not called"); } };
    await b.reconcile(never, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    expect((await b.status(now)).day.reservedMicros).toBe(10_000);
    await b.reconcile(never, new Date(now.getTime() + HARD_EXPIRY_MS + 1));
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });
});

describe("IP lookups with the period budget", () => {
  it("keeps total charges inside the budget when concurrent runs would together pass it", async () => {
    await open().setLimits({ dailyMicros: 10 * PRICE, monthlyMicros: 10 * PRICE });
    const f = fake(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return completed();
    });
    const outs = await Promise.all([0, 1, 2, 3].map((i) => run(f.looot, { ips: ips(8, 1 + i * 8), ledger: open() })));
    expect(f.chargedMicros()).toBeLessThanOrEqual(10 * PRICE);
    expect(f.calls.length).toBe(10);
    expect(outs.reduce((n, o) => n + o.spentMicros, 0)).toBe(10 * PRICE);
    const s = await open().status(now);
    expect(s.day.usedMicros).toBe(10 * PRICE);
    expect(s.day.reservedMicros).toBe(0);
    expect(outs.some((o) => o.budgetMessage)).toBe(true);
  });

  it("stops many small runs at the budget with a clear message", async () => {
    await open().setLimits({ dailyMicros: 3 * PRICE, monthlyMicros: 3 * PRICE });
    const f = fake();
    let last = "";
    for (let i = 0; i < 6; i++) {
      const o = await run(f.looot, { ips: [`203.0.113.${i + 1}`], ledger: open() });
      if (o.budgetMessage) last = o.budgetMessage;
    }
    expect(f.calls).toHaveLength(3);
    expect(last).toMatch(/daily budget is reached/i);
  });

  it("keeps the reservation of a pending call and does not count it as zero", async () => {
    const b = open();
    const f = fake(() => ({ runId: "run_slow", status: "running" }));
    const out = await run(f.looot, { ledger: b });
    expect(out.resolutions[IP].status).toBe("pending");
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(PRICE);
    expect(s.day.usedMicros).toBe(0);
  });

  it("settles a late completion to the real cost on the next reconcile", async () => {
    const b = open();
    await run(fake(() => ({ runId: "run_slow", status: "running" })).looot, { ledger: b });
    await b.reconcile({ getRun: async () => completed(0.0007) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(700);
  });

  it("releases the reservation when looot answers with an HTTP error", async () => {
    const b = open();
    const f = fake(() => { throw new LoootError("bad input", 400, "invalid_input"); });
    await run(f.looot, { ledger: b });
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(0);
  });

  it("releases a run looot reports failed at no charge", async () => {
    const b = open();
    await run(fake(() => ({ runId: "r", status: "failed", actualCost: 0, error: { code: "provider_error" } })).looot, { ledger: b });
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("keeps the reservation when the network fails and the outcome is unknown", async () => {
    const b = open();
    await run(fake(() => { throw new TypeError("fetch failed"); }).looot, { ledger: b });
    expect((await b.status(now)).day.reservedMicros).toBe(PRICE);
  });

  it("leaves a lookup the budget refused pending, with nothing called", async () => {
    const b = open();
    await b.setLimits({ dailyMicros: 400, monthlyMicros: 400 });
    const f = fake();
    const out = await run(f.looot, { ledger: b });
    expect(f.calls).toHaveLength(0);
    expect(out.notRun.ips).toEqual([IP]);
    expect(out.budgetMessage).toMatch(/budget is reached/i);
  });
});

describe("stable idempotency keys", () => {
  const stale = (domainResolvedAt: string) => ({ [IP]: { status: "company" as const, domain: "acme.example", resolvedAt: domainResolvedAt, costMicros: 0 } });

  it("uses the same key for a stale IP on two different days of one period", async () => {
    const start = 700 * 30 * 86_400_000;
    const day1 = new Date(start + 86_400_000);
    const day2 = new Date(start + 10 * 86_400_000);
    const a = fake();
    const c = fake();
    const old = stale("2026-09-01T00:00:00Z");
    await run(a.looot, { cache: old, now: day1 });
    await run(c.looot, { cache: old, now: day2 });
    expect(a.calls).toEqual(c.calls);
    expect(a.calls[0]).toBe(lookupKey("ipinfo", IP, refreshSalt(day1, 30)));
  });

  it("changes the key only when the cache period rolls over", () => {
    const t = new Date("2026-12-01T09:00:00Z");
    expect(refreshSalt(t, 30)).toBe(refreshSalt(new Date(t.getTime() + 86_400_000), 30));
    expect(refreshSalt(t, 30)).not.toBe(refreshSalt(new Date(t.getTime() + 31 * 86_400_000), 30));
    expect(refreshSalt(t, 30)).not.toBe("");
  });

  it("puts no date in a first lookup's key", async () => {
    const f = fake();
    await run(f.looot);
    expect(f.calls[0]).toBe(lookupKey("ipinfo", IP));
    expect(f.calls[0]).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("does not charge a repeated request twice when the stored answer is gone", async () => {
    const b = open();
    const f = fake();
    await run(f.looot, { ledger: b });
    await run(f.looot, { ledger: open() });
    expect(f.calls).toHaveLength(2);
    expect(new Set(f.calls).size).toBe(1);
    expect(f.chargedMicros()).toBe(PRICE);
    expect((await b.status(now)).day.usedMicros).toBe(PRICE);
  });

  it("makes no call for a fresh stored answer", async () => {
    const f = fake();
    const first = await run(f.looot, { ledger: open() });
    const second = await run(f.looot, { ledger: open(), cache: first.resolutions });
    expect(second.calls).toHaveLength(0);
    expect(f.calls).toHaveLength(1);
  });
});
