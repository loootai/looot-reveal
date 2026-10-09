/** "3h ago", "2d ago". Takes `now` so tests and screenshots are stable. */
export function ago(iso: string, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129_600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

const REASONS: Record<string, string> = {
  private_ip: "Private address",
  bogon: "Reserved address",
  isp: "Consumer ISP",
  hosting: "Hosting or cloud",
  vpn: "VPN, proxy or relay",
  no_domain: "Owner has no website",
  lookup_failed: "Lookup failed",
};
export const reasonLabel = (r: string): string => REASONS[r] ?? r;
