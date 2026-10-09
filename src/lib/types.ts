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
}

export type ExcludeReason = "private_ip" | "bogon" | "isp" | "hosting" | "vpn" | "no_domain" | "lookup_failed";

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
  /** Provider that supplied the IP lookup. */
  lookupProvider?: string;
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
}

export interface Excluded {
  count: number;
  byReason: Partial<Record<ExcludeReason, number>>;
}
