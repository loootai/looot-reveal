import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../config";
import { PERSON_CONDITIONS } from "../person/schema";
import { adminPolicy, assertPersonLevelAuth, isAuthConfigured, personLevelAllowed, PERSON_LEVEL_NEEDS_AUTH } from "./policy";

const PW = "a-long-enough-password";
const ON = ConfigSchema.parse({ personLevel: { enabled: true, acknowledgedTerms: "2026-10-11", acknowledgedConditions: PERSON_CONDITIONS.map((c) => c.id) } });

describe("adminPolicy", () => {
  it("demo with no token and no data file is open", () => {
    expect(adminPolicy({ NEXT_PUBLIC_DEMO: "1" }, false)).toEqual({ mode: "open-demo" });
  });
  it("demo next to a real token or data file refuses, unless a password is set", () => {
    expect(adminPolicy({ NEXT_PUBLIC_DEMO: "1" }, true)).toEqual({ mode: "setup", reason: "demo_with_real_data" });
    expect(adminPolicy({ NEXT_PUBLIC_DEMO: "1", REVEAL_ADMIN_PASSWORD: PW }, true).mode).toBe("login");
  });
  it("a normal run with no password is setup, not open", () => {
    expect(adminPolicy({}, false)).toEqual({ mode: "setup", reason: "no_password" });
    expect(adminPolicy({}, true).mode).toBe("setup");
  });
  it("a short password counts as not set", () => {
    expect(adminPolicy({ REVEAL_ADMIN_PASSWORD: "short" }, false)).toEqual({ mode: "setup", reason: "short_password" });
    expect(isAuthConfigured({ REVEAL_ADMIN_PASSWORD: "short" })).toBe(false);
  });
  it("a password or a hash turns on login", () => {
    expect(adminPolicy({ REVEAL_ADMIN_PASSWORD: PW }, false).mode).toBe("login");
    expect(adminPolicy({ REVEAL_ADMIN_PASSWORD_HASH: "scrypt$aa$bb" }, false).mode).toBe("login");
  });
});

describe("person-level needs admin auth", () => {
  it("is refused without a password", () => {
    expect(() => assertPersonLevelAuth(ON, {})).toThrow(PERSON_LEVEL_NEEDS_AUTH);
    expect(personLevelAllowed({})).toBe(false);
  });
  it("is allowed with a password, or in the demo with invented people", () => {
    expect(() => assertPersonLevelAuth(ON, { REVEAL_ADMIN_PASSWORD: PW })).not.toThrow();
    expect(() => assertPersonLevelAuth(ON, { NEXT_PUBLIC_DEMO: "1" })).not.toThrow();
  });
  it("is not checked while it is off", () => {
    expect(() => assertPersonLevelAuth(ConfigSchema.parse({}), {})).not.toThrow();
  });
});
