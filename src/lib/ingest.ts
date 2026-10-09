import { isIpAddress } from "./ip";
import type { Visit } from "./types";

export type LogFormat = "auto" | "combined" | "csv" | "jsonl";

export interface IngestResult {
  visits: Visit[];
  format: Exclude<LogFormat, "auto">;
  skipped: { assets: number; bots: number; badRows: number; errors: number };
}

const COMBINED = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+)[^"]*" (\d{3}) \S+(?: "([^"]*)" "([^"]*)")?/;
const ASSET = /\.(css|js|mjs|map|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|mp4|webm|json|xml|txt)$/i;
const BOT = /bot|crawl|spider|slurp|headless|preview|monitor|uptime|curl|wget|python-requests|go-http|axios|node-fetch|pingdom|lighthouse/i;
const MONTHS: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

/** Cuts the query string and fragment, which can carry email addresses or tokens, and caps the length. */
export function cleanPath(raw: string): string {
  let p = raw.trim();
  try {
    if (/^https?:\/\//i.test(p)) p = new URL(p).pathname;
  } catch {
    // keep the raw value
  }
  p = p.split("#")[0].split("?")[0] || "/";
  if (!p.startsWith("/")) p = `/${p}`;
  return p.slice(0, 200);
}

/** "10/Oct/2026:13:55:36 +0000" to an ISO string. Returns null when it does not parse. */
function combinedTime(s: string): string | null {
  const m = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})$/.exec(s);
  if (!m || !MONTHS[m[2]]) return null;
  const d = new Date(`${m[3]}-${MONTHS[m[2]]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}${m[7].slice(0, 3)}:${m[7].slice(3)}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toIso(s: string | undefined, fallback: string): string {
  if (!s) return fallback;
  const n = /^\d{10,13}$/.test(s) ? new Date(s.length === 10 ? Number(s) * 1000 : Number(s)) : new Date(s);
  return Number.isNaN(n.getTime()) ? fallback : n.toISOString();
}

export function detectFormat(text: string): Exclude<LogFormat, "auto"> {
  const first = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  if (COMBINED.test(first)) return "combined";
  if (first.trim().startsWith("{")) return "jsonl";
  return "csv";
}

/** Splits one CSV line, honouring double quotes. */
function csvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const IP_COLS = ["ip", "ip_address", "ipaddress", "client_ip", "remote_addr", "remote_ip", "visitor_ip", "c-ip"];
const PATH_COLS = ["path", "url", "page", "request_uri", "pathname", "uri", "cs-uri-stem", "page_url"];
const TIME_COLS = ["timestamp", "time", "date", "ts", "datetime", "created_at", "@timestamp"];
const REF_COLS = ["referrer", "referer", "ref"];

const colIndex = (header: string[], names: string[]) => header.findIndex((h) => names.includes(h.toLowerCase().replace(/[\s-]/g, "_")));

/**
 * Reads an access log or a CSV of visits into Visit rows.
 * Drops asset requests, bots, failed requests and rows without a valid IP. Query strings are cut.
 */
export function parseVisits(text: string, format: LogFormat = "auto", now: Date = new Date()): IngestResult {
  const fmt = format === "auto" ? detectFormat(text) : format;
  const skipped = { assets: 0, bots: 0, badRows: 0, errors: 0 };
  const visits: Visit[] = [];
  const fallbackTs = now.toISOString();
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");

  const push = (ip: string, path: string | undefined, ts: string, referrer?: string) => {
    if (!isIpAddress(ip)) return void skipped.badRows++;
    const p = cleanPath(path ?? "/");
    if (ASSET.test(p)) return void skipped.assets++;
    visits.push({ ip, path: p, ts, ...(referrer && referrer !== "-" ? { referrer: referrer.slice(0, 200) } : {}) });
  };

  if (fmt === "combined") {
    for (const line of lines) {
      const m = COMBINED.exec(line);
      if (!m) {
        skipped.badRows++;
        continue;
      }
      const [, ip, time, method, path, status, ref, ua] = m;
      if (method !== "GET" && method !== "HEAD") continue;
      if (Number(status) >= 400) {
        skipped.errors++;
        continue;
      }
      if (ua && BOT.test(ua)) {
        skipped.bots++;
        continue;
      }
      push(ip, path, combinedTime(time) ?? fallbackTs, ref);
    }
  } else if (fmt === "jsonl") {
    for (const line of lines) {
      try {
        const o = JSON.parse(line) as Record<string, unknown>;
        const pick = (names: string[]) => {
          for (const n of names) if (typeof o[n] === "string" || typeof o[n] === "number") return String(o[n]);
          return undefined;
        };
        if (typeof o.user_agent === "string" && BOT.test(o.user_agent)) {
          skipped.bots++;
          continue;
        }
        push(pick(IP_COLS) ?? "", pick(PATH_COLS), toIso(pick(TIME_COLS), fallbackTs), pick(REF_COLS));
      } catch {
        skipped.badRows++;
      }
    }
  } else {
    const first = csvLine(lines[0] ?? "");
    const hasHeader = colIndex(first, IP_COLS) >= 0;
    const header = hasHeader ? first : ["ip"];
    const iIp = hasHeader ? colIndex(header, IP_COLS) : 0;
    const iPath = colIndex(header, PATH_COLS);
    const iTime = colIndex(header, TIME_COLS);
    const iRef = colIndex(header, REF_COLS);
    for (const line of hasHeader ? lines.slice(1) : lines) {
      const cells = csvLine(line);
      push(cells[iIp] ?? "", iPath >= 0 ? cells[iPath] : undefined, toIso(iTime >= 0 ? cells[iTime] : undefined, fallbackTs), iRef >= 0 ? cells[iRef] : undefined);
    }
  }
  return { visits, format: fmt, skipped };
}
