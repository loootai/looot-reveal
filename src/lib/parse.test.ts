import { describe, expect, it } from "vitest";
import { parseCompany, parseIpInfo } from "./parse";

describe("parseIpInfo", () => {
  it("reads the company, ASN, location and privacy flags from the full answer", () => {
    const i = parseIpInfo("203.0.113.10", { ip: "203.0.113.10", city: "Austin", country: "US", asn: { asn: "AS64500", name: "Brightloop", domain: "www.Brightloop.example", type: "business" }, company: { name: "Brightloop Software", domain: "brightloop.example", type: "business" }, privacy: { vpn: false, proxy: false, tor: false, relay: false, hosting: false } });
    expect(i).toMatchObject({ name: "Brightloop Software", domain: "brightloop.example", kind: "business", country: "US", asn: "AS64500", vpn: false });
  });
  it("falls back to the ASN, then to the org string", () => {
    expect(parseIpInfo("1.1.1.1", { asn: { asn: "AS1", name: "Net One", domain: "netone.example", type: "isp" } })).toMatchObject({ name: "Net One", kind: "isp" });
    expect(parseIpInfo("1.1.1.1", { org: "AS15169 Google LLC" })).toMatchObject({ name: "Google LLC", asn: "AS15169", kind: "unknown", domain: undefined });
  });
  it("reads the lite answer", () => {
    expect(parseIpInfo("1.1.1.1", { asn: "AS64500", as_name: "Lite Corp", as_domain: "lite.example", country_code: "FR" })).toMatchObject({ name: "Lite Corp", domain: "lite.example", country: "FR", asn: "AS64500" });
  });
  it("marks a bogon and tolerates a wrapped or empty body", () => {
    expect(parseIpInfo("10.0.0.1", { ip: "10.0.0.1", bogon: true }).bogon).toBe(true);
    expect(parseIpInfo("1.1.1.1", { data: { org: "AS1 Wrapped Co" } }).name).toBe("Wrapped Co");
    expect(parseIpInfo("1.1.1.1", null).name).toBeUndefined();
  });
});

describe("parseCompany", () => {
  it("finds fields under the common names", () => {
    expect(parseCompany("a.example", { companyName: "A Co", industry: "Software", employeeCount: 120, countryCode: "US", description: "x" })).toEqual({ domain: "a.example", name: "A Co", industry: "Software", employees: 120, country: "US", description: "x" });
  });
  it("reads nested objects, ranges and arrays", () => {
    const c = parseCompany("b.example", { data: { company: { name: "B", industries: ["Retail", "Wholesale"], employee_range: "51-200", hq: { country: "FR" } } } });
    expect(c).toMatchObject({ name: "B", industry: "Retail", employees: 126 });
  });
  it("leaves missing fields undefined", () => {
    expect(parseCompany("c.example", {})).toEqual({ domain: "c.example" });
  });
});
