import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config";
import { ConfigSchema, DEFAULT_CONFIG } from "../config";
import { BLOCKED_COUNTRIES, PERSON_CONDITIONS } from "./schema";
import { isPersonLevelActive, regionVerdict, signalVerdict } from "./gates";

const ON = { enabled: true, acknowledgedTerms: "2026-10-11", acknowledgedConditions: PERSON_CONDITIONS.map((c) => c.id) };

describe("personLevel config", () => {
  it("is off by default, with no acknowledgement and region US only", () => {
    expect(DEFAULT_CONFIG.personLevel.enabled).toBe(false);
    expect(DEFAULT_CONFIG.personLevel.acknowledgedTerms).toBe("");
    expect(DEFAULT_CONFIG.personLevel.allowedRegions).toEqual(["US"]);
    expect(isPersonLevelActive(DEFAULT_CONFIG)).toBe(false);
  });
  it("refuses enabled: true without acknowledgedTerms", () => {
    expect(() => ConfigSchema.parse({ personLevel: { ...ON, acknowledgedTerms: "" } })).toThrow(/acknowledgedTerms/);
    expect(() => ConfigSchema.parse({ personLevel: { ...ON, acknowledgedTerms: "yesterday" } })).toThrow(/acknowledgedTerms/);
  });
  it("refuses enabled: true until every condition is ticked, and names the missing one", () => {
    const missing = PERSON_CONDITIONS[2].id;
    const ticked = PERSON_CONDITIONS.map((c) => c.id).filter((id) => id !== missing);
    expect(() => ConfigSchema.parse({ personLevel: { ...ON, acknowledgedConditions: ticked } })).toThrow(new RegExp(missing));
  });
  it("turns on with a date and all conditions", () => {
    const c = ConfigSchema.parse({ personLevel: ON });
    expect(isPersonLevelActive(c)).toBe(true);
  });
  it("ships with person-level off in reveal.config.json", () => {
    const c = parseConfig(readFileSync("reveal.config.json", "utf8"));
    expect(c.personLevel.enabled).toBe(false);
    expect(isPersonLevelActive(c)).toBe(false);
  });
  it("does not check the acknowledgement while the feature is off", () => {
    expect(() => ConfigSchema.parse({ personLevel: { enabled: false } })).not.toThrow();
  });
  it("refuses EU, UK and CH countries in allowedRegions", () => {
    for (const code of ["DE", "FR", "GB", "CH", "IE"]) {
      expect(() => ConfigSchema.parse({ personLevel: { ...ON, allowedRegions: ["US", code] } })).toThrow(new RegExp(code));
    }
    expect(BLOCKED_COUNTRIES.has("GB")).toBe(true);
    expect(BLOCKED_COUNTRIES.has("CH")).toBe(true);
    expect(BLOCKED_COUNTRIES.has("US")).toBe(false);
  });
  it("accepts a different non-blocked region", () => {
    expect(ConfigSchema.parse({ personLevel: { ...ON, allowedRegions: ["US", "CA"] } }).personLevel.allowedRegions).toEqual(["US", "CA"]);
  });
  it("requires an https supplier url when the http adapter is on", () => {
    const http = { enabled: true, label: "acme-ids", url: "http://api.supplier.example/v1", priceUsd: 0.1 };
    expect(() => ConfigSchema.parse({ personLevel: { ...ON, http } })).toThrow(/https/);
    expect(() => ConfigSchema.parse({ personLevel: { ...ON, http: { ...http, url: "https://api.supplier.example/v1" } } })).not.toThrow();
  });
});

describe("regionVerdict", () => {
  const cfg = ConfigSchema.parse({ personLevel: ON });
  it("allows the US", () => expect(regionVerdict("US", cfg)).toMatchObject({ allowed: true }));
  it("accepts lower case", () => expect(regionVerdict("us", cfg).allowed).toBe(true));
  it("blocks EU, UK and CH", () => {
    for (const c of ["DE", "FR", "NL", "GB", "CH"]) expect(regionVerdict(c, cfg)).toEqual({ allowed: false, reason: "blocked_region" });
  });
  it("blocks them even if a hand edited config lists them", () => {
    const tampered = { ...cfg, personLevel: { ...cfg.personLevel, allowedRegions: ["US", "DE", "GB"] } };
    expect(regionVerdict("DE", tampered).allowed).toBe(false);
    expect(regionVerdict("GB", tampered).allowed).toBe(false);
  });
  it("blocks a country that is not on the allow-list", () => expect(regionVerdict("BR", cfg)).toEqual({ allowed: false, reason: "region_not_allowed" }));
  it("blocks when the country is unknown", () => {
    expect(regionVerdict(undefined, cfg)).toEqual({ allowed: false, reason: "region_unknown" });
    expect(regionVerdict("", cfg).allowed).toBe(false);
  });
});

describe("signalVerdict", () => {
  const base = { gpc: false, dnt: false, personConsent: true };
  const on = ConfigSchema.parse({ personLevel: ON });
  it("passes with no objection and consent", () => expect(signalVerdict(base, on)).toEqual({ ok: true }));
  it("skips on Global Privacy Control", () => expect(signalVerdict({ ...base, gpc: true }, on)).toEqual({ ok: false, reason: "gpc" }));
  it("skips on Do Not Track", () => expect(signalVerdict({ ...base, dnt: true }, on)).toEqual({ ok: false, reason: "dnt" }));
  it("waits for consent when the gate is on", () => expect(signalVerdict({ ...base, personConsent: false }, on)).toEqual({ ok: false, reason: "no_consent" }));
  it("ignores consent when the gate is off, but never GPC", () => {
    const off = ConfigSchema.parse({ personLevel: { ...ON, requireConsent: false } });
    expect(signalVerdict({ ...base, personConsent: false }, off).ok).toBe(true);
    expect(signalVerdict({ gpc: true, dnt: false, personConsent: false }, off).ok).toBe(false);
  });
});
