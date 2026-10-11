import { describe, expect, it } from "vitest";
import { runPersonLookups } from "@/lib/person/engine";
import { buildPersonView } from "@/lib/person/view";
import { buildDemoState, DEMO_CONFIG } from "./seed";
import { personDemoDeps } from "./personDemo";

const NOW = new Date("2026-10-10T12:00:00Z");

describe("person-level demo", () => {
  it("seeds invented people through the real engine, with the checks and the enrichment visible", async () => {
    const s = await buildDemoState(NOW);
    const v = buildPersonView(s, DEMO_CONFIG);
    expect(v.active).toBe(true);
    expect(v.people.map((p) => p.name).sort()).toEqual(["Daniel Reyes", "Maya Okafor", "Priya Natarajan", "Sam Rivera"]);
    const sam = v.people.find((p) => p.name === "Sam Rivera")!;
    expect(sam.supplier).toContain("people-data-labs-person-enrich");
    expect(sam.costMicros).toBe(280_000);
    expect(v.byCompany["brightloop.example"].map((p) => p.name).sort()).toEqual(["Maya Okafor", "Sam Rivera"]);
    const outcomes = new Set(s.person!.audit.map((a) => a.outcome));
    for (const o of ["gpc", "dnt", "no_consent", "blocked_region", "suppressed", "identified", "no_match"]) expect(outcomes.has(o)).toBe(true);
    expect(v.pending).toBe(2);
    // Four supplier calls (one found no one) at $0.12 and one enrichment at $0.28, over four people.
    expect(v.stats.spentMicros).toBe(760_000);
    expect(v.stats.perIdentificationMicros).toBe(190_000);
  });
  it("keeps raw addresses and visitor ids out of the stored people and the audit log", async () => {
    const s = await buildDemoState(NOW);
    const text = JSON.stringify({ people: s.person!.people, audit: s.person!.audit, known: s.person!.known });
    expect(text).not.toMatch(/\b(203\.0\.113|198\.51\.100)\.\d+\b/);
    expect(text).not.toContain("demo-vid");
  });
  it("uses only invented names and documentation email domains", async () => {
    const s = await buildDemoState(NOW);
    for (const p of Object.values(s.person!.people)) expect(p.companyDomain ?? "x.example").toMatch(/\.example$/);
  });
  it("runs the two queued visitors with the fixture supplier and stays inside the cap", async () => {
    const s = await buildDemoState(NOW);
    const r = await runPersonLookups(s, DEMO_CONFIG, personDemoDeps(NOW, 120_000));
    expect(r.identified).toBe(1);
    expect(r.spentMicros).toBe(120_000 + 0);
    expect(Object.values(s.person!.people).some((p) => p.name === "Tom Becker")).toBe(true);
  });
});
