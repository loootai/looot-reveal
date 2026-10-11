import { z } from "zod";

/** The five conditions the setup page makes the user tick. The ids are stored in reveal.config.json. */
export const PERSON_CONDITIONS = [
  { id: "privacy_notice", label: "My privacy notice tells visitors that I identify people who visit the site, names each supplier, and says how long I keep the data." },
  { id: "opt_out_link", label: "My privacy notice links to this app's opt-out page, and I will keep that page reachable on the public internet." },
  { id: "honour_gpc", label: "I understand that this app skips every visitor whose browser sends Global Privacy Control or Do Not Track, and I will not turn that off." },
  { id: "supplier_contract", label: "I have a written contract with each identity supplier I connect, and it allows this use. looot supplies no person-level visitor identity." },
  { id: "legal_review", label: "A lawyer has reviewed my use of person-level identification for my business. I know this app gives no legal advice." },
] as const;
export type PersonConditionId = (typeof PERSON_CONDITIONS)[number]["id"];
export const CONDITION_IDS: string[] = PERSON_CONDITIONS.map((c) => c.id);

/** Countries where person-level identification is never attempted: the EU, the other EEA states, the UK and Switzerland. Not configurable. */
export const BLOCKED_COUNTRIES: ReadonlySet<string> = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "IS", "LI", "NO", "GB", "CH",
]);

/** A dotted path into a JSON body, for example "data.matches" or "hashed_email.sha256". Array indexes are numbers. */
const Path = z.string().max(200);

/** Which of our values go to the supplier, and under which field name. A value left out is not sent. */
const RequestMapSchema = z
  .object({
    fields: z
      .object({
        ip: Path.optional(),
        userAgent: Path.optional(),
        visitorId: Path.optional(),
        pageUrl: Path.optional(),
        timestamp: Path.optional(),
        emailSha256: Path.optional(),
      })
      .default({ ip: "ip", userAgent: "user_agent", visitorId: "visitor_id", pageUrl: "page_url", timestamp: "timestamp", emailSha256: "email_sha256" }),
    /** Constant fields added to every request, for example an API version. */
    static: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  })
  .prefault({});

/** Where each candidate field sits in the supplier's answer. */
const ResponseMapSchema = z
  .object({
    /** Path to the array of candidates. Empty means the body itself is one candidate (or an array of them). */
    matchesPath: Path.default(""),
    fields: z
      .object({
        emailSha256: Path.optional(),
        emailMd5: Path.optional(),
        name: Path.optional(),
        workEmail: Path.optional(),
        linkedinUrl: Path.optional(),
        title: Path.optional(),
        company: Path.optional(),
        companyDomain: Path.optional(),
        confidence: Path.optional(),
      })
      .default({}),
    /** 1 when confidence is already 0 to 1, 100 when the supplier scores 0 to 100. */
    confidenceScale: z.number().positive().default(1),
  })
  .prefault({});

/** The generic HTTP adapter: your own identity-resolution supplier, configured, not bundled. */
export const HttpAdapterSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** Short name shown in the audit log and the costs page. */
    label: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes").default("my-supplier"),
    url: z.string().default(""),
    method: z.enum(["POST", "GET"]).default("POST"),
    /** Header that carries the key. The key itself is read from the environment variable named in authEnv and never stored. */
    authHeader: z.string().min(1).default("Authorization"),
    authEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/, "use an UPPER_SNAKE_CASE environment variable name").default("REVEAL_PERSON_API_KEY"),
    /** Text put before the key. "Bearer " for most APIs, empty for an X-Api-Key style header. */
    authPrefix: z.string().default("Bearer "),
    /** What one call costs under your contract, in dollars. Used for the quote and the spend cap. */
    priceUsd: z.number().min(0).default(0),
    timeoutMs: z.number().int().min(500).max(30_000).default(8000),
    request: RequestMapSchema,
    response: ResponseMapSchema,
  })
  .superRefine((h, ctx) => {
    if (!h.enabled) return;
    let ok = false;
    try {
      const u = new URL(h.url);
      ok = u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname));
    } catch {
      ok = false;
    }
    if (!ok) ctx.addIssue({ code: "custom", path: ["url"], message: "the supplier url must be https (http is allowed only for localhost)" });
  });
export type HttpAdapterConfig = z.infer<typeof HttpAdapterSchema>;

/** Name and list price of the looot step that turns a hashed email into a person. Prices are list prices from the public catalog. */
export const EnrichSchema = z.object({
  enabled: z.boolean().default(false),
  /** looot endpoint id. People Data Labs person enrich accepts email_hash. */
  endpointId: z.string().min(1).default("people-data-labs-person-enrich"),
  priceUsd: z.number().min(0).default(0.28),
  /** People Data Labs min_likelihood, 1 to 10. Higher means fewer, surer matches. */
  minLikelihood: z.number().int().min(1).max(10).default(6),
});
export type EnrichConfig = z.infer<typeof EnrichSchema>;

export const PersonLevelSchema = z
  .object({
    /** Off by default. Turning it on also needs acknowledgedTerms and every condition in acknowledgedConditions. */
    enabled: z.boolean().default(false),
    /** The date (YYYY-MM-DD) you accepted the conditions. */
    acknowledgedTerms: z.string().default(""),
    acknowledgedConditions: z.array(z.string()).default([]),
    /** Two-letter country codes where lookups may run. EU, EEA, UK and CH codes are refused here and blocked in code. */
    allowedRegions: z.array(z.string().regex(/^[A-Za-z]{2}$/, "use two-letter country codes like US")).min(1).default(["US"]),
    /** true: no lookup until the visitor's consent banner reports consent. */
    requireConsent: z.boolean().default(true),
    /** People, links between a first-party id and an email hash, and queued addresses older than this are deleted. */
    retentionDays: z.number().int().min(1).max(3650).default(30),
    /** The audit log holds no names, emails or addresses. It is kept longer so you can show what was checked. */
    auditRetentionDays: z.number().int().min(1).max(3650).default(365),
    /** Hard cap for one person-level run, in dollars. */
    spendCapUsd: z.number().min(0).default(1),
    /** false keeps only a hash of a work email the supplier returns. */
    storeWorkEmail: z.boolean().default(false),
    /** Candidates the supplier scores below this (0 to 1) are dropped. */
    minConfidence: z.number().min(0).max(1).default(0),
    knownVisitor: z.object({ enabled: z.boolean().default(true) }).prefault({}),
    http: HttpAdapterSchema.prefault({}),
    enrich: EnrichSchema.prefault({}),
  })
  .superRefine((p, ctx) => {
    for (const r of p.allowedRegions) {
      if (BLOCKED_COUNTRIES.has(r.toUpperCase())) ctx.addIssue({ code: "custom", path: ["allowedRegions"], message: `${r.toUpperCase()} is in the EU, EEA, UK or Switzerland and is always blocked` });
    }
    if (!p.enabled) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.acknowledgedTerms) || Number.isNaN(Date.parse(p.acknowledgedTerms))) {
      ctx.addIssue({ code: "custom", path: ["acknowledgedTerms"], message: "set acknowledgedTerms to the date you accepted the conditions, as YYYY-MM-DD, before enabling person-level identification" });
    }
    const missing = CONDITION_IDS.filter((id) => !p.acknowledgedConditions.includes(id));
    if (missing.length > 0) ctx.addIssue({ code: "custom", path: ["acknowledgedConditions"], message: `tick every condition before enabling person-level identification. Missing conditions: ${missing.join(", ")}` });
  });
export type PersonLevelConfig = z.infer<typeof PersonLevelSchema>;
