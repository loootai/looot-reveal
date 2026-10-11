import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { LoootRunner } from "@/lib/looot";
import { buildFeed } from "@/lib/feed";
import { loadState, statePathFromEnv } from "@/lib/store";
import { runCli } from "./run";

const NOW = new Date("2026-10-10T12:00:00Z");
const LOG = '203.0.113.10 - - [10/Oct/2026:10:00:00 +0000] "GET /pricing HTTP/1.1" 200 1 "-" "Mozilla/5.0"\n203.0.113.10 - - [10/Oct/2026:10:01:00 +0000] "GET /docs HTTP/1.1" 200 1 "-" "Mozilla/5.0"\n10.0.0.1 - - [10/Oct/2026:10:02:00 +0000] "GET / HTTP/1.1" 200 1 "-" "Mozilla/5.0"\n';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "reveal-test-"));
  const input = join(dir, "access.log");
  writeFileSync(input, LOG);
  const out: string[] = [];
  const err: string[] = [];
  const looot: LoootRunner = {
    runAndWait: vi.fn(async (e: string) =>
      e === "ipinfo--2"
        ? { runId: "r", status: "completed", actualCost: 0.0005, result: { company: { name: "Brightloop", domain: "brightloop.example", type: "business" }, country: "US" } }
        : { runId: "r", status: "completed", actualCost: 0.0019, result: { name: "Brightloop", industry: "Software", employee_count: 180, country: "US" } },
    ),
  };
  const deps = { env: {}, out: (s: string) => out.push(s), err: (s: string) => err.push(s), now: NOW, looot };
  const args = (...more: string[]) => ["--input", input, "--out", join(dir, "out"), "--state", join(dir, "state.json"), "--config", join(dir, "none.json"), ...more];
  return { dir, out, err, looot, deps, args };
}

describe("runCli", () => {
  it("--dry-run prints the list-price cost, makes no call and writes nothing", async () => {
    const t = setup();
    expect(await runCli(t.args("--dry-run"), t.deps)).toBe(0);
    expect(t.looot.runAndWait).not.toHaveBeenCalled();
    expect(t.out.join("\n")).toContain("Most this run can cost: $0.0024");
    expect(existsSync(join(t.dir, "out"))).toBe(false);
    expect(existsSync(join(t.dir, "state.json"))).toBe(false);
  });
  it("refuses a run whose quote is above the period budget, and --partial runs until it is reached", async () => {
    const t = setup();
    const deps = { ...t.deps, env: { LOOOT_REVEAL_DAILY_USD: "0.0006", LOOOT_REVEAL_MONTHLY_USD: "0.0006" } };
    expect(await runCli(t.args(), deps)).toBe(2);
    expect(t.looot.runAndWait).not.toHaveBeenCalled();
    expect(t.err.join("\n")).toContain("above what is left of the period budget");
    expect(await runCli(t.args("--partial"), deps)).toBe(0);
    expect(t.out.join("\n")).toContain("Stopped by the period budget");
    expect((t.looot.runAndWait as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeLessThanOrEqual(1);
  });
  it("runs, writes json, csv and markdown, and a second run costs nothing", async () => {
    const t = setup();
    expect(await runCli(t.args(), t.deps)).toBe(0);
    const json = JSON.parse(readFileSync(join(t.dir, "out", "visitors.json"), "utf8"));
    expect(json.companies[0]).toMatchObject({ domain: "brightloop.example", visits: 2 });
    expect(readFileSync(join(t.dir, "out", "visitors.csv"), "utf8")).toContain('"Brightloop","brightloop.example"');
    expect(readFileSync(join(t.dir, "out", "visitors.md"), "utf8")).toContain("## Why these match");
    // IPinfo Lite finds nothing in this mock, then IPinfo full answers, then one enrichment.
    expect(t.looot.runAndWait).toHaveBeenCalledTimes(3);
    expect(await runCli(t.args(), t.deps)).toBe(0);
    expect(t.looot.runAndWait).toHaveBeenCalledTimes(3);
  });
  it("stops at --cap and says so", async () => {
    const t = setup();
    await runCli(t.args("--cap", "0.0001"), t.deps);
    // Only the free provider fits under the cap.
    expect(t.looot.runAndWait).toHaveBeenCalledTimes(1);
    expect(t.out.join("\n")).toContain("Stopped at the $0.0001 cap");
  });
  it("exits 2 without LOOOT_TOKEN, and for a missing --input", async () => {
    const t = setup();
    expect(await runCli(t.args(), { ...t.deps, looot: undefined })).toBe(2);
    expect(t.err.join("\n")).toContain("LOOOT_TOKEN is not set");
    expect(await runCli([], t.deps)).toBe(2);
  });

  it("writes to the file the web UI reads, so a CLI run shows up in the UI", async () => {
    const t = setup();
    const REVEAL_DATA = join(t.dir, "shared", "reveal.json");
    const env = { REVEAL_DATA };
    const args = ["--input", join(t.dir, "access.log"), "--out", join(t.dir, "out"), "--config", join(t.dir, "none.json")];
    expect(await runCli(args, { ...t.deps, env })).toBe(0);
    // The UI resolves its path with the same function, from the same variable.
    const uiPath = statePathFromEnv(env);
    expect(uiPath).toBe(REVEAL_DATA);
    const state = loadState(uiPath);
    const feed = buildFeed(state.visits, state.resolutions, state.companies, (await import("@/lib/config")).DEFAULT_CONFIG);
    expect(feed.companies.map((c) => c.domain)).toEqual(["brightloop.example"]);
  });
  it("uses data/reveal.json by default and moves an old state/reveal.json there", async () => {
    const { migrateLegacyState, statePathFromEnv: p } = await import("@/lib/store");
    expect(p({}).endsWith(join("data", "reveal.json"))).toBe(true);
    const t = setup();
    const legacy = join(t.dir, "state", "reveal.json");
    const target = join(t.dir, "data", "reveal.json");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(t.dir, "state"));
    writeFileSync(legacy, '{"version":1}');
    expect(migrateLegacyState(target, legacy)).toBe(true);
    expect(existsSync(legacy)).toBe(false);
    expect(readFileSync(target, "utf8")).toBe('{"version":1}');
    expect(migrateLegacyState(target, legacy)).toBe(false);
  });
});
