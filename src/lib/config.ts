import { z } from "zod";

/** Words in a network owner name that mark a consumer ISP, a mobile carrier or a host. Used when the provider gives no network type. Edit the list in reveal.config.json. */
export const DEFAULT_HINTS = ["comcast", "verizon", "at&t", "spectrum", "charter", "cox comm", "vodafone", "orange", "telefonica", "deutsche telekom", "bt group", "virgin media", "sky broadband", "t-mobile", "free sas", "bouygues", "amazon", "google llc", "microsoft", "digitalocean", "ovh", "hetzner", "cloudflare", "akamai", "linode", "vultr", "broadband", "wireless", "mobile", "cellular", "residential", "telecom", "telekom", "hosting", "cloud"];

const signalBase = { id: z.string().min(1), label: z.string().min(1), weight: z.number().min(0).max(100) };

/** One ICP check. Weights are edited in reveal.config.json. */
export const IcpSignalSchema = z.discriminatedUnion("kind", [
  z.object({ ...signalBase, kind: z.literal("text"), field: z.enum(["industry", "country", "description", "name"]), anyOf: z.array(z.string().min(1)).min(1) }),
  z.object({ ...signalBase, kind: z.literal("employees"), min: z.number().int().min(0).default(0), max: z.number().int().min(1).optional() }),
  z.object({ ...signalBase, kind: z.literal("pages"), paths: z.array(z.string().min(1)).min(1) }),
]);
export type IcpSignal = z.infer<typeof IcpSignalSchema>;

/** How much a provider's answer proves. asn_owner: the registered owner of the network, never enough to stop. network_type: the answer says if the network is a business, ISP or host. company: the provider resolves the IP to a company itself. */
export const TrustSchema = z.enum(["asn_owner", "network_type", "company"]);
export type Trust = z.infer<typeof TrustSchema>;

/** One IP-to-company provider in the waterfall. Order in the list is the order of the calls. */
export const ProviderSchema = z.object({
  /** Short name shown in the feed and the costs page. Unique. */
  id: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes"),
  /** looot endpoint id the call is sent to. */
  endpointId: z.string().min(1),
  label: z.string().min(1),
  /** Which response parser reads the answer. "ipinfo" reads IPinfo bodies, "pdl" reads People Data Labs IP enrichment bodies. */
  adapter: z.enum(["ipinfo", "pdl"]),
  trust: TrustSchema,
  /** List price of one call in dollars, from the looot catalog. Used for the quote and the cap. */
  priceUsd: z.number().min(0),
  enabled: z.boolean().default(true),
});
export type ProviderConfig = z.infer<typeof ProviderSchema>;

/** The providers looot lists today for IP to company, cheapest first. Prices read from the public catalog on 2026-10-10. */
export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  { id: "ipinfo-lite", endpointId: "ipinfo-lite", label: "IPinfo Lite (ASN owner)", adapter: "ipinfo", trust: "asn_owner", priceUsd: 0, enabled: true },
  { id: "ipinfo", endpointId: "ipinfo--2", label: "IPinfo (full lookup)", adapter: "ipinfo", trust: "network_type", priceUsd: 0.0005, enabled: true },
  { id: "people-data-labs", endpointId: "people-data-labs-ip-enrich", label: "People Data Labs (IP enrichment)", adapter: "pdl", trust: "company", priceUsd: 0.28, enabled: false },
];

export const WaterfallSchema = z
  .object({
    providers: z.array(ProviderSchema).min(1).default(DEFAULT_PROVIDERS),
    /** true: after the first confident match, ask one more company-level provider and compare. Costs more, catches wrong matches. */
    crossCheck: z.boolean().default(false),
    /** A stored answer for an IP is reused for this many days, then looked up again. 0 looks every IP up on every run. */
    cacheDays: z.number().int().min(0).max(3650).default(30),
    /** IPv4 ranges (CIDR) that are never looked up, for example your own office or a known ISP block. */
    skipCidrs: z.array(z.string().regex(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/, "use an IPv4 range like 203.0.113.0/24")).default([]),
  })
  .refine((w) => new Set(w.providers.map((p) => p.id)).size === w.providers.length, { message: "provider ids must be unique" });
export type WaterfallConfig = z.infer<typeof WaterfallSchema>;

/** Old configs had `lookup: "ipinfo" | "ipinfo-lite"`. Turn that into a waterfall with the other providers off. */
function upgradeOldConfig(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const o = raw as Record<string, unknown>;
  if (o.waterfall !== undefined || (o.lookup !== "ipinfo" && o.lookup !== "ipinfo-lite")) return raw;
  const { lookup, ...rest } = o;
  return { ...rest, waterfall: { providers: DEFAULT_PROVIDERS.map((p) => ({ ...p, enabled: lookup === "ipinfo-lite" ? p.id === "ipinfo-lite" : p.id !== "people-data-labs" })) } };
}

const ConfigObject = z.object({
  waterfall: WaterfallSchema.default({ providers: DEFAULT_PROVIDERS, crossCheck: false, cacheDays: 30, skipCidrs: [] }),
  /** Run the company enrichment job on each new company domain. */
  enrich: z.boolean().default(true),
  /** Hard cap for one run, in dollars. A run stops before a call that would pass it. */
  spendCapUsd: z.number().min(0).default(1),
  /** Visits and cached lookups older than this are deleted. */
  retentionDays: z.number().int().min(1).max(3650).default(30),
  /** false keeps only a salted hash of each IP once it is resolved. */
  storeRawIp: z.boolean().default(false),
  ignorePaths: z.array(z.string()).default(["/api", "/_next", "/favicon.ico", "/robots.txt", "/sitemap.xml"]),
  /** Names of networks that are consumer ISPs or clouds, used when the provider gives no network type. */
  networkNameHints: z.array(z.string()).default(DEFAULT_HINTS),
  icp: z
    .object({
      threshold: z.number().min(0).default(3),
      signals: z.array(IcpSignalSchema).default([]),
    })
    .default({ threshold: 3, signals: [] }),
});
export const ConfigSchema = z.preprocess(upgradeOldConfig, ConfigObject) as unknown as z.ZodType<RevealConfig, unknown>;
export type RevealConfig = z.infer<typeof ConfigObject>;

/** The config a new install starts with. Edit reveal.config.json to change it. */
export const DEFAULT_CONFIG: RevealConfig = ConfigSchema.parse({
  icp: {
    threshold: 4,
    signals: [
      { id: "industry", label: "Industry is software or services", kind: "text", field: "industry", anyOf: ["software", "saas", "information technology", "internet", "marketing", "consulting"], weight: 2 },
      { id: "size", label: "20 to 2,000 employees", kind: "employees", min: 20, max: 2000, weight: 2 },
      { id: "country", label: "Based in a target country", kind: "text", field: "country", anyOf: ["US", "GB", "DE", "FR", "NL", "CA"], weight: 1 },
      { id: "pricing", label: "Viewed the pricing page", kind: "pages", paths: ["/pricing", "/plans"], weight: 3 },
    ],
  },
});

/** Parses a config file body and fills in defaults. Throws a ZodError with the field path when it is wrong. */
export function parseConfig(text: string): RevealConfig {
  return ConfigSchema.parse(JSON.parse(text));
}
