import type { CompanyProfile, IpInfo, NetworkKind } from "./types";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

/** looot returns the provider body as `result`. Some providers wrap it again in `data`. */
function unwrap(body: unknown): Obj {
  if (!isObj(body)) return {};
  if (isObj(body.data) && !("ip" in body)) return body.data;
  return body;
}

function kindOf(t: unknown): NetworkKind {
  const s = typeof t === "string" ? t.toLowerCase() : "";
  if (s === "business") return "business";
  if (s === "isp") return "isp";
  if (s === "hosting") return "hosting";
  if (s === "education") return "education";
  if (s === "government") return "government";
  return "unknown";
}

/** Strips the "AS15169 " prefix IPinfo puts in front of the `org` field. */
function nameFromOrg(org: string | undefined): string | undefined {
  if (!org) return undefined;
  return org.replace(/^AS\d+\s+/i, "").trim() || undefined;
}

/**
 * Normalises an IPinfo body (full /{ip} answer or the lite answer).
 * Built from IPinfo's public field list, not from a recorded paid call.
 */
export function parseIpInfo(ip: string, body: unknown): IpInfo {
  const b = unwrap(body);
  const company = isObj(b.company) ? b.company : {};
  const asn = isObj(b.asn) ? b.asn : {};
  const privacy = isObj(b.privacy) ? b.privacy : {};
  const org = str(b.org);
  // The lite answer uses flat as_name / as_domain fields.
  const name = str(company.name) ?? str(asn.name) ?? str(b.as_name) ?? nameFromOrg(org);
  const domain = str(company.domain) ?? str(asn.domain) ?? str(b.as_domain);
  const kind = kindOf(company.type ?? asn.type);
  const asnId = str(asn.asn) ?? str(b.asn) ?? /^AS\d+/i.exec(org ?? "")?.[0];
  return {
    ip,
    bogon: b.bogon === true,
    name,
    domain: domain?.toLowerCase().replace(/^www\./, ""),
    asn: asnId,
    kind,
    country: str(b.country) ?? str(b.country_code),
    region: str(b.region),
    city: str(b.city),
    vpn: privacy.vpn === true,
    proxy: privacy.proxy === true,
    tor: privacy.tor === true,
    relay: privacy.relay === true,
    hosting: privacy.hosting === true || kindOf(company.type ?? asn.type) === "hosting",
  };
}

/** Depth-limited search for the first value under any of the given keys. */
function find(o: unknown, keys: string[], depth = 3): unknown {
  if (!isObj(o) || depth < 0) return undefined;
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  for (const v of Object.values(o)) {
    if (isObj(v)) {
      const hit = find(v, keys, depth - 1);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

function toCount(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string") {
    const range = /^(\d[\d,]*)\s*[-–to]+\s*(\d[\d,]*)/.exec(v);
    if (range) return Math.round((Number(range[1].replace(/,/g, "")) + Number(range[2].replace(/,/g, ""))) / 2);
    const n = Number(v.replace(/[,+\s]/g, ""));
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return undefined;
}

/**
 * Pulls a company profile out of whatever company.enrich returned. Providers name fields differently,
 * so each field is looked up under the common names. Missing fields stay undefined.
 */
export function parseCompany(domain: string, body: unknown): CompanyProfile {
  const b = unwrap(body);
  const industry = find(b, ["industry", "industries", "sector"]);
  const country = find(b, ["country_code", "countryCode", "country", "hq_country"]);
  return {
    domain,
    name: str(find(b, ["name", "companyName", "company_name", "legal_name"])),
    industry: Array.isArray(industry) ? str(industry[0]) : isObj(industry) ? str(industry.name) : str(industry),
    employees: toCount(find(b, ["employee_count", "employeeCount", "employees", "headcount", "staff_count", "size", "employee_range", "employeeRange"])),
    country: isObj(country) ? str(country.code) ?? str(country.name) : str(country),
    description: str(find(b, ["description", "short_description", "tagline"])),
  };
}
