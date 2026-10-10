import { isIP } from "node:net";

/** true for an IP that can never belong to a visiting company: private, loopback, link-local, CGNAT, multicast. */
export function isNonPublicIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::1" || s === "::") return true;
    if (s.startsWith("fe8") || s.startsWith("fe9") || s.startsWith("fea") || s.startsWith("feb")) return true;
    if (s.startsWith("fc") || s.startsWith("fd")) return true;
    if (s.startsWith("ff")) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isNonPublicIp(mapped[1]);
    return false;
  }
  return true;
}

/** true when the string is an IPv4 or IPv6 address. */
export function isIpAddress(s: string): boolean {
  return isIP(s) !== 0;
}

/** true when an IPv4 address is inside the CIDR range, for example 203.0.113.0/24. IPv6 and bad input never match. */
export function inCidr(ip: string, cidr: string): boolean {
  const [base, bitsText] = cidr.split("/");
  const bits = Number(bitsText);
  if (isIP(ip) !== 4 || isIP(base) !== 4 || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const n = (a: string) => a.split(".").reduce((x, p) => x * 256 + Number(p), 0);
  const size = 2 ** (32 - bits);
  return Math.floor(n(ip) / size) === Math.floor(n(base) / size);
}
