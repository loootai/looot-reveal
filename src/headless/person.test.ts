import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigSchema } from "@/lib/config";
import { md5Email, sha256Email } from "@/lib/person/hash";
import { optOutEmail, queuePersonVisit, runPersonLookups } from "@/lib/person/engine";
import { PERSON_CONDITIONS } from "@/lib/person/schema";
import { emptyState } from "@/lib/state";
import { loadState, saveState } from "@/lib/store";
import { runCli } from "./run";

const NOW = new Date("2026-10-11T12:00:00Z");

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "reveal-person-"));
  const statePath = join(dir, "state.json");
  const configPath = join(dir, "reveal.config.json");
  writeFileSync(configPath, JSON.stringify({ personLevel: { enabled: true, acknowledgedTerms: "2026-10-11", acknowledgedConditions: PERSON_CONDITIONS.map((c) => c.id) } }));
  const config = ConfigSchema.parse(JSON.parse(JSON.stringify({ personLevel: { enabled: true, acknowledgedTerms: "2026-10-11", acknowledgedConditions: PERSON_CONDITIONS.map((c) => c.id) } })));
  const state = emptyState();
  queuePersonVisit(state, config, { ip: "203.0.113.9", userAgent: "UA", path: "/pricing", visitorId: "v1", emailHash: sha256Email("grace@example.org"), gpc: false, dnt: false, personConsent: true, country: "US" }, NOW);
  await runPersonLookups(state, config, { looot: null, fetch: fetch, env: {}, now: NOW, capMicros: 0 });
  saveState(statePath, state);
  const out: string[] = [];
  const err: string[] = [];
  const run = (...args: string[]) => runCli(["person", ...args, "--state", statePath, "--config", configPath], { env: {}, out: (s) => out.push(s), err: (s) => err.push(s), now: NOW });
  return { dir, statePath, run, out, err };
}

describe("reveal person", () => {
  it("delete --email removes the person and leaves the suppression list alone", async () => {
    const t = await setup();
    expect(Object.keys(loadState(t.statePath).person!.people)).toHaveLength(1);
    expect(await t.run("delete", "--email", "grace@example.org")).toBe(0);
    const s = loadState(t.statePath);
    expect(s.person!.people).toEqual({});
    expect(s.person!.suppression).toEqual([]);
    expect(t.out.join("\n")).toContain("Deleted 1 stored people");
  });
  it("delete --email --suppress also suppresses the hashes", async () => {
    const t = await setup();
    expect(await t.run("delete", "--email", "grace@example.org", "--suppress")).toBe(0);
    const kinds = loadState(t.statePath).person!.suppression;
    expect(kinds.map((e) => e.value).sort()).toEqual([md5Email("grace@example.org"), sha256Email("grace@example.org")].sort());
  });
  it("suppress --file adds a list", async () => {
    const t = await setup();
    const f = join(t.dir, "list.txt");
    writeFileSync(f, "a@example.org\ncompetitor.example\n");
    expect(await t.run("suppress", "--file", f)).toBe(0);
    expect(loadState(t.statePath).person!.suppression).toHaveLength(3);
  });
  it("purge and audit run", async () => {
    const t = await setup();
    expect(await t.run("purge")).toBe(0);
    expect(await t.run("audit", "--limit", "5")).toBe(0);
    expect(t.out.join("\n")).toContain("identified");
  });
  it("rejects a bad email and an unknown command with exit code 2", async () => {
    const t = await setup();
    expect(await t.run("delete", "--email", "nope")).toBe(2);
    expect(await t.run("frobnicate")).toBe(2);
    expect(await t.run()).toBe(2);
  });
  it("opt-out and the CLI agree on the hashes", () => {
    const s = emptyState();
    optOutEmail(s, "grace@example.org", NOW);
    expect(s.person!.suppression.map((e) => e.value)).toContain(sha256Email("grace@example.org"));
  });
});
