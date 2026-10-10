import { ConfigSchema, DEFAULT_CONFIG, DEFAULT_PROVIDERS, type RevealConfig } from "@/lib/config";
import { addVisits, emptyState, resolvePending, type State } from "@/lib/state";
import type { Visit } from "@/lib/types";
import { DemoRunner } from "./fixtureRunner";

const HOUR = 3_600_000;

/** A fixed list of page views, as hours before `now`. Deterministic, so screenshots and tests are stable. */
function demoVisits(now: Date): Visit[] {
  const at = (h: number) => new Date(now.getTime() - h * HOUR).toISOString();
  const v = (ip: string, h: number, path: string, referrer?: string): Visit => ({ ip, path, ts: at(h), ...(referrer ? { referrer } : {}) });
  return [
    v("203.0.113.10", 2, "/", "https://www.google.com/"),
    v("203.0.113.10", 1.9, "/features"),
    v("203.0.113.10", 1.8, "/pricing"),
    v("203.0.113.11", 30, "/pricing"),
    v("203.0.113.11", 29.9, "/docs/getting-started"),
    v("203.0.113.20", 5, "/blog/lead-routing", "https://www.linkedin.com/"),
    v("203.0.113.20", 4.9, "/pricing"),
    v("203.0.113.20", 4.8, "/contact"),
    v("203.0.113.30", 50, "/"),
    v("203.0.113.30", 49.9, "/features"),
    v("203.0.113.40", 12, "/pricing", "https://news.example/"),
    v("203.0.113.40", 11.9, "/docs/api"),
    v("203.0.113.40", 11.8, "/docs/getting-started"),
    v("203.0.113.40", 11.7, "/pricing"),
    v("203.0.113.50", 70, "/blog/lead-routing"),
    v("203.0.113.60", 8, "/"),
    v("203.0.113.60", 7.9, "/plans"),
    v("203.0.113.55", 14, "/pricing"),
    v("203.0.113.55", 13.9, "/features"),
    v("203.0.113.65", 16, "/pricing"),
    v("203.0.113.65", 15.9, "/docs/api"),
    v("198.51.100.10", 3, "/"),
    v("198.51.100.10", 2.9, "/pricing"),
    v("198.51.100.11", 20, "/"),
    v("198.51.100.12", 26, "/blog/lead-routing"),
    v("198.51.100.12", 25.9, "/features"),
    v("198.51.100.20", 6, "/"),
    v("198.51.100.30", 9, "/pricing"),
    v("10.0.0.5", 1, "/"),
  ];
}

/** The demo turns People Data Labs on so the feed shows a third provider and one disagreement. Nothing is saved from the demo. */
export const DEMO_CONFIG: RevealConfig = ConfigSchema.parse({ ...DEFAULT_CONFIG, waterfall: { ...DEFAULT_CONFIG.waterfall, providers: DEFAULT_PROVIDERS.map((p) => ({ ...p, enabled: true })) } });

/** Builds the demo state by running the real engine over made-up visits and a fixture runner. */
export async function buildDemoState(now: Date = new Date(), config: RevealConfig = DEMO_CONFIG): Promise<State> {
  const state = emptyState();
  state.salt = "demo";
  addVisits(state, demoVisits(now), config, now);
  await resolvePending(state, config, new DemoRunner(), 1_000_000, now);
  // Three fresh IPs are left unresolved so the Import page has a quote to show and a run to try.
  const at = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
  addVisits(state, [{ ip: "203.0.113.80", path: "/pricing", ts: at(20) }, { ip: "203.0.113.70", path: "/", ts: at(15) }, { ip: "198.51.100.40", path: "/features", ts: at(5) }], config, now);
  return state;
}

export { DemoRunner };
