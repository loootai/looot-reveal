/** Date the list prices in this app were read from the public looot catalog. */
export const PRICES_AS_OF = "2026-10-10";

/** Job id every IP lookup provider is recorded under in the call log. */
export const IP_LOOKUP_JOB = "ip.lookup";

/** The company enrichment call. looot picks the provider; the price is the cheapest list price for the job. */
export const COMPANY_ENRICH = { jobId: "company.enrich", endpointId: "job:company.enrich", providerId: "job", label: "Company enrichment", priceMicros: 1900 } as const;
