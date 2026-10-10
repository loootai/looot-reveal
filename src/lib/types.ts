/** One page view. The query string is already stripped from `path`. */
export interface Visit {
  ip: string;
  path: string;
  ts: string;
  referrer?: string;
}

/** A visit as stored. `ipKey` is a salted hash unless storeRawIp is on. */
export interface StoredVisit {
  ipKey: string;
  path: string;
  ts: string;
  referrer?: string;
}

export type NetworkKind = "business" | "education" | "government" | "isp" | "hosting" | "unknown";

/** What the IP lookup says about an address, normalised from the provider body. */
export interface IpInfo {
  ip: string;
  bogon: boolean;
  /** Owner name of the network: IPinfo company name, else the ASN name. */
  name?: string;
  /** Website of the owner, when the provider gives one. */
  domain?: string;
  asn?: string;
  kind: NetworkKind;
  country?: string;
  region?: string;
  city?: string;
  vpn: boolean;
  proxy: boolean;
  tor: boolean;
  relay: boolean;
  hosting: boolean;
  /** true for a mobile carrier address. */
  mobile: boolean;
}

export type ExcludeReason = "private_ip" | "bogon" | "isp" | "mobile" | "hosting" | "vpn" | "no_domain" | "skipped_range" | "lookup_failed";

/** What one provider said about one IP. */
export type AnswerOutcome =
  /** A company, and the provider's evidence is strong enough to stop the waterfall. */
  | "match"
  /** A company, but only the registered network owner or a network of unknown type. */
  | "weak"
  /** The provider says this is not a company: ISP, mobile, hosting or VPN. */
  | "excluded"
  /** The provider answered and found no company. */
  | "none"
  | "failed"
  | "pending";

export interface ProviderAnswer {
  provider: string;
  endpointId: string;
  outcome: AnswerOutcome;
  name?: string;
  domain?: string;
  reason?: ExcludeReason;
  costMicros: number;
}

export type Confidence = "high" | "medium" | "low";

/** Fields from the company enrichment job, all optional because providers differ. */
export interface CompanyProfile {
  domain: string;
  name?: string;
  industry?: string;
  employees?: number;
  country?: string;
  description?: string;
}

export interface CallRecord {
  job: string;
  providerId: string;
  key: string;
  costMicros: number;
  status: string;
  at: string;
}

/** The outcome for one IP. Cached so the same address is never looked up twice. */
export interface Resolution {
  status: "company" | "excluded" | "pending" | "failed";
  reason?: ExcludeReason;
  info?: IpInfo;
  /** Company website the visit is attributed to. */
  domain?: string;
  name?: string;
  /** Provider whose answer was used. */
  lookupProvider?: string;
  /** high: a confident match nobody contradicts. medium: only a weak match (network owner). low: providers named different companies. */
  confidence?: Confidence;
  /** Every provider that was asked, in call order, with its answer and cost. */
  answers?: ProviderAnswer[];
  /** Other companies named by providers that disagree with the one above. Set only when confidence is low. */
  alternatives?: { provider: string; name?: string; domain: string }[];
  /** Total of the answers' costs. */
  costMicros: number;
  resolvedAt: string;
}

export interface IcpSignalResult {
  id: string;
  label: string;
  weight: number;
  matched: boolean;
  /** The value the check looked at, shown to the user. */
  value: string;
  /** Where the value came from. */
  provider: string;
  /** What the call that supplied the value cost. Shared across the signals it fed. */
  costMicros: number;
}

export interface IcpResult {
  matched: boolean;
  score: number;
  maxScore: number;
  threshold: number;
  signals: IcpSignalResult[];
}

export interface CompanyVisit {
  domain: string;
  name: string;
  profile?: CompanyProfile;
  country?: string;
  visits: number;
  uniqueIps: number;
  firstSeen: string;
  lastSeen: string;
  pages: { path: string; views: number }[];
  icp: IcpResult;
  costMicros: number;
  /** Lowest confidence among the addresses attributed to this company. */
  confidence: Confidence;
  /** Which provider answered how many addresses, and what those answers cost. */
  answeredBy: { provider: string; ips: number; costMicros: number }[];
  /** Companies other providers named for the same addresses. Empty unless confidence is low. */
  alternatives: { provider: string; name?: string; domain: string }[];
  /** One entry per address: how it was resolved. The address itself is never shown. */
  lookups: { confidence: Confidence; provider: string; costMicros: number; answers: ProviderAnswer[] }[];
}

export interface Excluded {
  count: number;
  byReason: Partial<Record<ExcludeReason, number>>;
}
