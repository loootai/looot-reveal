import { describe, expect, it } from "vitest";
import { cleanPath, detectFormat, parseVisits } from "./ingest";

const LOG = [
  '203.0.113.10 - - [10/Oct/2026:13:55:36 +0000] "GET /pricing?utm=x&email=a@example.com HTTP/1.1" 200 2326 "https://www.google.com/" "Mozilla/5.0"',
  '203.0.113.10 - - [10/Oct/2026:13:55:37 +0000] "GET /static/app.js HTTP/1.1" 200 100 "-" "Mozilla/5.0"',
  '198.51.100.7 - - [10/Oct/2026:13:56:00 +0000] "GET / HTTP/1.1" 200 500 "-" "Googlebot/2.1"',
  '198.51.100.8 - - [10/Oct/2026:13:57:00 +0000] "GET /missing HTTP/1.1" 404 10 "-" "Mozilla/5.0"',
  '198.51.100.9 - - [10/Oct/2026:13:58:00 +0000] "POST /form HTTP/1.1" 200 10 "-" "Mozilla/5.0"',
  "garbage line",
].join("\n");

describe("parseVisits", () => {
  it("reads a combined log, drops assets, bots and errors, and cuts the query string", () => {
    const r = parseVisits(LOG);
    expect(r.format).toBe("combined");
    expect(r.visits).toEqual([{ ip: "203.0.113.10", path: "/pricing", ts: "2026-10-10T13:55:36.000Z", referrer: "https://www.google.com/" }]);
    expect(r.skipped).toMatchObject({ bots: 1, errors: 1, badRows: 1 });
  });
  it("reads a CSV with a header and finds the columns by name", () => {
    const r = parseVisits('client_ip,url,timestamp,referer\n203.0.113.20,https://x.example/blog/a?id=3,2026-10-09T10:00:00Z,\n"not-an-ip",/,2026-10-09T10:00:00Z,', "auto");
    expect(r.format).toBe("csv");
    expect(r.visits).toEqual([{ ip: "203.0.113.20", path: "/blog/a", ts: "2026-10-09T10:00:00.000Z" }]);
    expect(r.skipped.badRows).toBe(1);
  });
  it("reads a bare list of IPs, one per line", () => {
    const now = new Date("2026-10-10T00:00:00Z");
    const r = parseVisits("203.0.113.1\n2001:db8::1\n", "auto", now);
    expect(r.visits.map((v) => v.ip)).toEqual(["203.0.113.1", "2001:db8::1"]);
    expect(r.visits[0]).toMatchObject({ path: "/", ts: now.toISOString() });
  });
  it("reads JSON lines and skips bot user agents", () => {
    const r = parseVisits('{"ip":"203.0.113.5","path":"/a","ts":1760000000}\n{"ip":"203.0.113.6","path":"/b","user_agent":"AhrefsBot"}', "auto");
    expect(r.format).toBe("jsonl");
    expect(r.visits).toHaveLength(1);
    expect(r.visits[0].ts).toBe("2025-10-09T08:53:20.000Z");
  });
  it("detects the format from the first line", () => {
    expect(detectFormat(LOG)).toBe("combined");
    expect(detectFormat("ip,path\n1.1.1.1,/")).toBe("csv");
  });
});

describe("cleanPath", () => {
  it("strips query, fragment and host and keeps the path", () => {
    expect(cleanPath("https://a.example/x/y?token=1#top")).toBe("/x/y");
    expect(cleanPath("pricing")).toBe("/pricing");
    expect(cleanPath("")).toBe("/");
  });
});
