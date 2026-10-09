/** The looot calls this app makes, with list prices in micro-dollars (read 2026-10-10 from the public catalog). */
export const PRICES_AS_OF = "2026-10-10";

export const JOBS = {
  /** Full IP lookup: location, ASN, network type, owner company and privacy flags where the plan gives them. */
  ipLookup: { jobId: "ip.lookup", endpointId: "ipinfo--2", providerId: "ipinfo", label: "IP lookup", priceMicros: 500 },
  /** Free IP lookup: ASN owner name, domain and country. */
  ipLookupLite: { jobId: "ip.lookup", endpointId: "ipinfo-lite", providerId: "ipinfo", label: "IP lookup (lite)", priceMicros: 0 },
  /** Company profile from a domain. looot picks the provider; the price is the cheapest list price for the job. */
  companyEnrich: { jobId: "company.enrich", endpointId: "job:company.enrich", providerId: "job", label: "Company enrichment", priceMicros: 1900 },
} as const;

export type JobKey = keyof typeof JOBS;
