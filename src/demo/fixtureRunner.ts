import type { LoootRun, LoootRunner } from "@/lib/looot";

/** Made-up answers shaped like IPinfo's response. Addresses are the RFC 5737 documentation ranges, companies are invented. */
interface Net {
  name: string;
  domain: string;
  type: "business" | "isp" | "hosting" | "education" | "government";
  country: string;
  city: string;
  region: string;
  vpn?: boolean;
}

export const DEMO_NETS: Record<string, Net> = {
  "203.0.113.10": { name: "Brightloop Software", domain: "brightloop.example", type: "business", country: "US", city: "Austin", region: "Texas" },
  "203.0.113.11": { name: "Brightloop Software", domain: "brightloop.example", type: "business", country: "US", city: "Austin", region: "Texas" },
  "203.0.113.20": { name: "Harbor & Finch Consulting", domain: "harborfinch.example", type: "business", country: "GB", city: "London", region: "England" },
  "203.0.113.30": { name: "Kestrel Logistics", domain: "kestrellogistics.example", type: "business", country: "NL", city: "Rotterdam", region: "South Holland" },
  "203.0.113.40": { name: "Orbit Payments", domain: "orbitpay.example", type: "business", country: "DE", city: "Berlin", region: "Berlin" },
  "203.0.113.50": { name: "Pine Valley University", domain: "pinevalley.example", type: "education", country: "CA", city: "Calgary", region: "Alberta" },
  "203.0.113.60": { name: "Lumen Retail Group", domain: "lumenretail.example", type: "business", country: "FR", city: "Lyon", region: "Auvergne-Rhone-Alpes" },
  "198.51.100.10": { name: "Example Broadband", domain: "examplebroadband.example", type: "isp", country: "US", city: "Denver", region: "Colorado" },
  "198.51.100.11": { name: "Example Broadband", domain: "examplebroadband.example", type: "isp", country: "US", city: "Dallas", region: "Texas" },
  "198.51.100.12": { name: "Example Mobile", domain: "examplemobile.example", type: "isp", country: "GB", city: "Leeds", region: "England" },
  "198.51.100.20": { name: "Sample Cloud Hosting", domain: "samplecloud.example", type: "hosting", country: "US", city: "Ashburn", region: "Virginia" },
  "198.51.100.30": { name: "Private Relay Network", domain: "privaterelay.example", type: "business", country: "US", city: "Newark", region: "New Jersey", vpn: true },
};

const COMPANIES: Record<string, { name: string; industry: string; employee_count: number; country: string; description: string }> = {
  "brightloop.example": { name: "Brightloop Software", industry: "Software Development", employee_count: 180, country: "US", description: "Scheduling software for field service teams." },
  "harborfinch.example": { name: "Harbor & Finch Consulting", industry: "Management Consulting", employee_count: 45, country: "GB", description: "Operations consulting for mid-size manufacturers." },
  "kestrellogistics.example": { name: "Kestrel Logistics", industry: "Transportation and Logistics", employee_count: 3200, country: "NL", description: "Road freight and warehousing across the Benelux." },
  "orbitpay.example": { name: "Orbit Payments", industry: "Financial Technology", employee_count: 95, country: "DE", description: "Payment links for small online shops." },
  "pinevalley.example": { name: "Pine Valley University", industry: "Higher Education", employee_count: 1400, country: "CA", description: "Public university with 18,000 students." },
  "lumenretail.example": { name: "Lumen Retail Group", industry: "Retail", employee_count: 620, country: "FR", description: "Home goods stores in eastern France." },
};

const ok = (result: unknown, cost: number, n: number): LoootRun => ({ runId: `demo_${n}`, status: "completed", result, actualCost: cost });

/** Stands in for looot in demo mode and in tests of the UI. Never makes a network call. */
export class DemoRunner implements LoootRunner {
  calls = 0;
  async runAndWait(endpointId: string, input: Record<string, unknown>): Promise<LoootRun> {
    this.calls++;
    if (endpointId.startsWith("ipinfo")) {
      const ip = String(input.ip);
      const net = DEMO_NETS[ip] ?? { name: "Example Broadband", domain: "examplebroadband.example", type: "isp" as const, country: "US", city: "Unknown", region: "Unknown" };
      if (endpointId === "ipinfo-lite") return ok({ ip, asn: "AS64500", as_name: net.name, as_domain: net.domain, country_code: net.country, country: net.country }, 0, this.calls);
      return ok(
        {
          ip,
          city: net.city,
          region: net.region,
          country: net.country,
          asn: { asn: "AS64500", name: net.name, domain: net.domain, type: net.type },
          company: { name: net.name, domain: net.domain, type: net.type },
          privacy: { vpn: net.vpn ?? false, proxy: false, tor: false, relay: false, hosting: net.type === "hosting" },
        },
        0.0005,
        this.calls,
      );
    }
    const domain = String(input.domain);
    const c = COMPANIES[domain];
    if (!c) return { runId: `demo_${this.calls}`, status: "failed", error: { code: "not_found", message: "No company for this domain" }, actualCost: 0 };
    return ok({ ...c, domain }, 0.0019, this.calls);
  }
}
