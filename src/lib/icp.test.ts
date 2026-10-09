import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "./config";
import { scoreIcp } from "./icp";

const ctx = (over = {}) => ({ profile: { domain: "a.example", industry: "Software Development", employees: 180, country: "US" }, profileProvider: "leadmagic", profileCostMicros: 1900, info: undefined, lookupProvider: "ipinfo", lookupCostMicros: 500, paths: ["/", "/pricing"], ...over });

describe("scoreIcp", () => {
  it("lists every signal with its weight, value, provider and cost, and flags a match at the threshold", () => {
    const r = scoreIcp(DEFAULT_CONFIG, ctx());
    expect(r.matched).toBe(true);
    expect(r.score).toBe(8);
    expect(r.maxScore).toBe(8);
    expect(r.signals.map((s) => [s.id, s.matched, s.provider, s.costMicros])).toEqual([
      ["industry", true, "leadmagic", 1900],
      ["size", true, "leadmagic", 1900],
      ["country", true, "leadmagic", 1900],
      ["pricing", true, "your visit data", 0],
    ]);
  });
  it("does not match below the threshold", () => {
    const r = scoreIcp(DEFAULT_CONFIG, ctx({ profile: { domain: "a.example", industry: "Retail", employees: 5, country: "US" }, paths: ["/"] }));
    expect(r).toMatchObject({ matched: false, score: 1 });
  });
  it("reports unknown values as unmatched, and takes the country from the IP lookup when the profile has none", () => {
    const r = scoreIcp(DEFAULT_CONFIG, ctx({ profile: undefined, info: { country: "DE" }, paths: [] }));
    const country = r.signals.find((s) => s.id === "country")!;
    expect(country).toMatchObject({ matched: true, value: "DE", provider: "ipinfo", costMicros: 500 });
    expect(r.signals.find((s) => s.id === "size")).toMatchObject({ matched: false, value: "unknown" });
  });
});
