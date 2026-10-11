import type { RevealConfig } from "@/lib/config";
import type { LoootRun, LoootRunner } from "@/lib/looot";
import { md5Email, sha256Email } from "@/lib/person/hash";
import { EXAMPLE_HTTP_CONFIG } from "@/lib/person/notice";
import { queuePersonVisit, runPersonLookups, importSuppression, type PersonRunDeps, type VisitSignals } from "@/lib/person/engine";
import type { State } from "@/lib/state";
import { DemoRunner } from "./fixtureRunner";

/** Every person in the demo is invented. Addresses use the documentation ranges and the example.com family of domains. */
export const DEMO_SUPPLIER_URL = "https://identity-supplier.example/v1/resolve";

interface Invented {
  name: string;
  title: string;
  company: string;
  domain: string;
  email: string;
  score: number;
}

const BY_IP: Record<string, Invented> = {
  "203.0.113.10": { name: "Maya Okafor", title: "VP Revenue", company: "Brightloop Software", domain: "brightloop.example", email: "maya.okafor@example.com", score: 91 },
  "203.0.113.65": { name: "Daniel Reyes", title: "Director of Operations", company: "Marlow & Pike Architects", domain: "marlowpike.example", email: "daniel.reyes@example.com", score: 62 },
  "198.51.100.11": { name: "Priya Natarajan", title: "Head of Analytics", company: "Fernwood Analytics", domain: "fernwood.example", email: "priya.natarajan@example.com", score: 74 },
  "203.0.113.80": { name: "Tom Becker", title: "Founder", company: "Becker Field Services", domain: "beckerfield.example", email: "tom.becker@example.com", score: 83 },
};

/** The person Sam Rivera is known to the site (a form submit), so the supplier is never asked. looot enrichment names her. */
export const DEMO_KNOWN_EMAIL = "sam.rivera@example.com";

/** Stands in for the user's identity supplier. No network call. */
export const demoSupplierFetch: typeof fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as { client_ip?: string };
  const hit = body.client_ip ? BY_IP[body.client_ip] : undefined;
  const matches = hit
    ? [{ hashed_email: { sha256: sha256Email(hit.email), md5: md5Email(hit.email) }, full_name: hit.name, job_title: hit.title, company_name: hit.company, company_domain: hit.domain, score: hit.score }]
    : [];
  return new Response(JSON.stringify({ data: { matches } }), { status: 200, headers: { "Content-Type": "application/json" } });
};

/** Stands in for looot: People Data Labs person enrich for the known visitor, and the demo company fixtures for the rest. */
export class DemoPersonRunner implements LoootRunner {
  private readonly inner = new DemoRunner();
  async runAndWait(endpointId: string, input: Record<string, unknown>): Promise<LoootRun> {
    if (endpointId === "people-data-labs-person-enrich") {
      if (input.email_hash === sha256Email(DEMO_KNOWN_EMAIL)) {
        return { runId: "demo_pdl", status: "completed", actualCost: 0.28, result: { status: 200, likelihood: 9, data: { full_name: "Sam Rivera", job_title: "Account Executive", job_company_name: "Brightloop Software", job_company_website: "brightloop.example", linkedin_url: "linkedin.com/in/sam-rivera-sample" } } };
      }
      return { runId: "demo_pdl", status: "failed", actualCost: 0, error: { code: "not_found", message: "No match (404)" } };
    }
    return this.inner.runAndWait(endpointId, input);
  }
}

/** The environment the demo supplier reads its key from. A made-up value; the fixture ignores it. */
export const demoEnv: Record<string, string> = { [EXAMPLE_HTTP_CONFIG.authEnv]: "demo" };

export const personDemoDeps = (now: Date, capMicros = 5_000_000): PersonRunDeps => ({ looot: new DemoPersonRunner(), fetch: demoSupplierFetch, env: demoEnv, now, capMicros });

const HOUR = 3_600_000;

/** Fills state.person by running the real person-level engine over invented visits. Nothing here is a real person. */
export async function seedDemoPeople(state: State, config: RevealConfig, now: Date): Promise<void> {
  const at = (h: number) => new Date(now.getTime() - h * HOUR);
  const sig = (ip: string, vid: string, path: string, over: Partial<VisitSignals> = {}): VisitSignals => ({ ip, userAgent: "Mozilla/5.0", path, origin: "https://www.example.com", visitorId: vid, gpc: false, dnt: false, personConsent: true, country: "US", ...over });
  importSuppression(state, "optout.sample@example.com\ncompetitor.example", at(100), "optout");
  const visits: [number, VisitSignals][] = [
    [2, sig("203.0.113.10", "demo-vid-1", "/")],
    [1.9, sig("203.0.113.10", "demo-vid-1", "/features")],
    [1.8, sig("203.0.113.10", "demo-vid-1", "/pricing")],
    [30, sig("203.0.113.11", "demo-vid-3", "/docs/getting-started", { emailHash: sha256Email(DEMO_KNOWN_EMAIL) })],
    [29.9, sig("203.0.113.11", "demo-vid-3", "/pricing")],
    [16, sig("203.0.113.65", "demo-vid-2", "/pricing")],
    [15.9, sig("203.0.113.65", "demo-vid-2", "/docs/api")],
    [26, sig("198.51.100.11", "demo-vid-4", "/blog/lead-routing")],
    [25.9, sig("198.51.100.11", "demo-vid-4", "/features")],
    [9, sig("198.51.100.30", "demo-vid-5", "/pricing")],
    // Refused before any lookup. These show up in the audit log.
    [12, sig("203.0.113.40", "demo-vid-6", "/pricing", { country: "DE" })],
    [11, sig("203.0.113.20", "demo-vid-7", "/pricing", { country: "GB" })],
    [10, sig("198.51.100.12", "demo-vid-8", "/", { gpc: true })],
    [8, sig("198.51.100.13", "demo-vid-9", "/", { dnt: true })],
    [7, sig("198.51.100.14", "demo-vid-10", "/", { personConsent: false })],
    [6, sig("198.51.100.15", "demo-vid-11", "/", { emailHash: sha256Email("optout.sample@example.com") })],
  ];
  for (const [h, s] of visits) queuePersonVisit(state, config, s, at(h));
  await runPersonLookups(state, config, personDemoDeps(now));
  // Two visitors are left queued so the People page has a quote and a run to try.
  queuePersonVisit(state, config, sig("203.0.113.80", "demo-vid-12", "/pricing"), at(0.3));
  queuePersonVisit(state, config, sig("198.51.100.40", "demo-vid-13", "/features"), at(0.2));
}
