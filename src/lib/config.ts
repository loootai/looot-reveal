import { z } from "zod";

const signalBase = { id: z.string().min(1), label: z.string().min(1), weight: z.number().min(0).max(100) };

/** One ICP check. Weights are edited in reveal.config.json. */
export const IcpSignalSchema = z.discriminatedUnion("kind", [
  z.object({ ...signalBase, kind: z.literal("text"), field: z.enum(["industry", "country", "description", "name"]), anyOf: z.array(z.string().min(1)).min(1) }),
  z.object({ ...signalBase, kind: z.literal("employees"), min: z.number().int().min(0).default(0), max: z.number().int().min(1).optional() }),
  z.object({ ...signalBase, kind: z.literal("pages"), paths: z.array(z.string().min(1)).min(1) }),
]);
export type IcpSignal = z.infer<typeof IcpSignalSchema>;

export const ConfigSchema = z.object({
  /** ipinfo is the full lookup ($0.0005), ipinfo-lite is free and has the ASN owner but no network type. */
  lookup: z.enum(["ipinfo", "ipinfo-lite"]).default("ipinfo"),
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
  networkNameHints: z.array(z.string()).default(["comcast", "verizon", "at&t", "spectrum", "charter", "cox comm", "vodafone", "orange", "telefonica", "deutsche telekom", "bt group", "virgin media", "sky broadband", "t-mobile", "free sas", "bouygues", "amazon", "google llc", "microsoft", "digitalocean", "ovh", "hetzner", "cloudflare", "akamai", "linode", "vultr"]),
  icp: z
    .object({
      threshold: z.number().min(0).default(3),
      signals: z.array(IcpSignalSchema).default([]),
    })
    .default({ threshold: 3, signals: [] }),
});
export type RevealConfig = z.infer<typeof ConfigSchema>;

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
