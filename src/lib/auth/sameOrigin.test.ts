import { describe, expect, it } from "vitest";
import { sameOrigin } from "./guard";

const h = (o: Record<string, string>) => new Headers(o);

describe("sameOrigin", () => {
  it("accepts a matching Origin", () => {
    expect(sameOrigin(h({ host: "a.test", origin: "https://a.test" }))).toBe(true);
  });
  it("refuses a different Origin", () => {
    expect(sameOrigin(h({ host: "a.test", origin: "https://b.test" }))).toBe(false);
  });
  it("accepts Origin null when Sec-Fetch-Site says same-origin (no-referrer form post)", () => {
    expect(sameOrigin(h({ host: "a.test", origin: "null", "sec-fetch-site": "same-origin" }))).toBe(true);
  });
  it("refuses Origin null from another site", () => {
    expect(sameOrigin(h({ host: "a.test", origin: "null", "sec-fetch-site": "cross-site" }))).toBe(false);
  });
  it("refuses Origin null with no Sec-Fetch-Site", () => {
    expect(sameOrigin(h({ host: "a.test", origin: "null" }))).toBe(false);
  });
});
