import "server-only";
import { resolve } from "node:path";
import { buildDemoState, DemoRunner } from "@/demo/seed";
import { ConfigSchema, DEFAULT_CONFIG, type RevealConfig } from "./config";
import { buildFeed, type Feed } from "./feed";
import { addVisits, purgeOld, quotePending, resolvePending, type State } from "./state";
import { hasLoootToken, loootFromEnv, type LoootRunner } from "./looot";
import { parseVisits, type LogFormat } from "./ingest";
import { toMicros } from "./money";
import type { Quote } from "./quote";
import { loadConfig, loadState, saveConfig, saveState } from "./store";

export const isDemo = (): boolean => process.env.NEXT_PUBLIC_DEMO === "1";

const statePath = () => resolve(/* turbopackIgnore: true */ process.env.REVEAL_DATA ?? "data/reveal.json");
const configPath = () => resolve(/* turbopackIgnore: true */ process.env.REVEAL_CONFIG ?? "reveal.config.json");

const g = globalThis as unknown as { __revealDemo?: Promise<{ state: State; config: RevealConfig }> };

/** In demo mode the state lives in memory and resets on restart. Otherwise it is a JSON file. */
async function open(): Promise<{ state: State; config: RevealConfig; save: () => void; looot: LoootRunner | null }> {
  if (isDemo()) {
    g.__revealDemo ??= buildDemoState().then((state) => ({ state, config: DEFAULT_CONFIG }));
    const d = await g.__revealDemo;
    return { ...d, save: () => {}, looot: new DemoRunner() };
  }
  const state = loadState(statePath());
  return { state, config: loadConfig(configPath()), save: () => saveState(statePath(), state), looot: hasLoootToken() ? loootFromEnv() : null };
}

export interface View {
  demo: boolean;
  hasToken: boolean;
  config: RevealConfig;
  feed: Feed;
  pendingIps: number;
  quote: Quote;
  spentMicros: number;
  retention: { days: number; oldest: string | null };
  /** Server time in ms, so pages show relative times without calling the clock while rendering. */
  now: number;
}

/** Everything a page needs, computed from the stored state. Free: makes no looot call. */
export async function getView(): Promise<View> {
  const { state, config, looot } = await open();
  const feed = buildFeed(state.visits, state.resolutions, state.companies, config);
  const quote = quotePending(state, config, Math.round(config.spendCapUsd * 1_000_000));
  const oldest = state.visits.reduce<string | null>((m, v) => (m === null || v.ts < m ? v.ts : m), null);
  return {
    demo: isDemo(),
    hasToken: looot !== null,
    config,
    feed,
    pendingIps: Object.keys(state.pendingIps).length,
    quote,
    spentMicros: state.calls.reduce((n, c) => n + c.costMicros, 0),
    retention: { days: config.retentionDays, oldest },
    now: Date.now(),
  };
}

/** Free. Parses a pasted log or CSV and stores the visits. IPs wait for an explicit resolve. */
export async function importText(text: string, format: LogFormat) {
  const { state, config, save } = await open();
  const parsed = parseVisits(text, format);
  const { newIps } = addVisits(state, parsed.visits, config);
  save();
  return { format: parsed.format, visits: parsed.visits.length, newIps, skipped: parsed.skipped };
}

/** Free. Stores one visit from the tracking snippet. */
export async function collectVisit(ip: string, path: string, referrer?: string) {
  const { state, config, save } = await open();
  const { visits } = parseVisits(`ip,path,referrer\n${ip},${path.replace(/[",\n]/g, "")},${(referrer ?? "").replace(/[",\n]/g, "")}\n`, "csv");
  addVisits(state, visits, config);
  save();
}

/** Paid. Resolves the pending IPs, stopping before a call that would pass the cap. */
export async function runResolve(capUsd: number | undefined) {
  const { state, config, looot, save } = await open();
  if (!looot) throw new Error("LOOOT_TOKEN is not set on the server.");
  const cap = toMicros(capUsd ?? config.spendCapUsd);
  const out = await resolvePending(state, config, looot, cap, new Date());
  save();
  return { spentMicros: out.spentMicros, calls: out.calls.length, notRun: out.notRun.ips.length + out.notRun.domains.length, pending: Object.keys(state.pendingIps).length };
}

export async function purge() {
  const { state, config, save } = await open();
  const r = purgeOld(state, config, new Date());
  save();
  return r;
}

/** Writes a new reveal.config.json after validating it. Not available in demo mode. */
export async function updateConfig(raw: unknown): Promise<RevealConfig> {
  if (isDemo()) throw new Error("The demo does not save settings.");
  const config = ConfigSchema.parse(raw);
  saveConfig(configPath(), config);
  return config;
}
