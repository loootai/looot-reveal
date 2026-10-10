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
    proxy: privacy.proxy === true || privacy.res_proxy === true,
    tor: privacy.tor === true,
    relay: privacy.relay === true,
    hosting: privacy.hosting === true || kindOf(company.type ?? asn.type) === "hosting",
    // IPinfo adds a `carrier` object (name, mcc, mnc) for mobile networks.
    mobile: isObj(b.carrier),
  };
}

const hostOf = (v: unknown): string | undefined => {
  const t = str(v);
  if (!t) return undefined;
  return t.toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0] || undefined;
};

/**
 * Normalises a People Data Labs IP enrichment body into the same shape as an IPinfo answer.
 * PDL resolves the IP to a company itself, so a present `company` means a company-level match.
 * Only company fields are read. A `person` object, if the provider ever sends one, is ignored.
 * Built from the endpoint description in the looot catalog, not from a recorded paid call.
 */
export function parsePdlIp(ip: string, body: unknown): IpInfo {
  const b = unwrap(body);
  const d = isObj(b.data) ? b.data : b;
  const company = isObj(d.company) ? d.company : {};
  const ipObj = isObj(d.ip) ? d.ip : {};
  const meta = isObj(ipObj.metadata) ? ipObj.metadata : {};
  const loc = isObj(ipObj.location) ? ipObj.location : {};
  const cLoc = isObj(company.location) ? company.location : {};
  const flag = (k: string) => meta[k] === true || ipObj[k] === true;
  const name = str(company.name);
  return {
    ip,
    bogon: false,
    name,
    domain: hostOf(company.website) ?? hostOf(company.domain),
    kind: name ? "business" : "unknown",
    country: str(cLoc.country) ?? str(loc.country),
    region: str(cLoc.region) ?? str(loc.region),
    city: str(cLoc.locality) ?? str(loc.locality),
    vpn: flag("vpn"),
    proxy: flag("proxy"),
    tor: flag("tor"),
    relay: false,
    hosting: flag("hosting") || flag("datacenter"),
    mobile: flag("mobile"),
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
