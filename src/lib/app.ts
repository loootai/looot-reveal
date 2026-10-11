import "server-only";
import { resolve } from "node:path";
import { buildDemoState, DEMO_CONFIG } from "@/demo/seed";
import { demoEnv, demoSupplierFetch, DemoPersonRunner } from "@/demo/personDemo";
import { ConfigSchema, type RevealConfig } from "./config";
import { buildFeed, type Feed } from "./feed";
import { addVisits, purgeOld, quotePending, resolvePending, type State } from "./state";
import { hasLoootToken, loootFromEnv, type LoootRunner } from "./looot";
import { parseVisits, type LogFormat } from "./ingest";
import { toMicros } from "./money";
import type { Quote } from "./quote";
import { isPersonLevelActive } from "./person/gates";
import { PERSON_IDENTIFY_JOB, queuePersonVisit, runPersonLookups, type VisitSignals } from "./person/engine";
import { addAudit, deleteByEmail, importSuppression, optOutEmail, purgePerson, removeSuppression } from "./person/store";
import { buildPersonView, type PersonView } from "./person/view";
import type { SuppressionEntry } from "./person/types";
import type { CallRecord } from "./types";
import { loadConfig, loadState, migrateLegacyState, saveConfig, saveState, statePathFromEnv } from "./store";

export const isDemo = (): boolean => process.env.NEXT_PUBLIC_DEMO === "1";

const statePath = () => {
  const p = statePathFromEnv();
  migrateLegacyState(p);
  return p;
};
const configPath = () => resolve(/* turbopackIgnore: true */ process.env.REVEAL_CONFIG ?? "reveal.config.json");

const g = globalThis as unknown as { __revealDemo?: Promise<{ state: State; config: RevealConfig }> };

/** In demo mode the state lives in memory and resets on restart. Otherwise it is a JSON file. */
async function open(): Promise<{ state: State; config: RevealConfig; save: () => void; looot: LoootRunner | null }> {
  if (isDemo()) {
    g.__revealDemo ??= buildDemoState().then((state) => ({ state, config: DEMO_CONFIG }));
    const d = await g.__revealDemo;
    return { ...d, save: () => {}, looot: new DemoPersonRunner() };
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
  /** Every looot call the state remembers, grouped by provider, plus the latest ones. */
  costs: { byProvider: { provider: string; job: string; calls: number; failed: number; costMicros: number }[]; recent: CallRecord[] };
  retention: { days: number; oldest: string | null };
  /** Person-level data for the People, Suppression and Audit pages. Empty and inactive unless the feature is on. */
  person: PersonView;
  /** Server time in ms, so pages show relative times without calling the clock while rendering. */
  now: number;
}

/** Groups the call log by provider and job. Recent calls are newest first. */
export function summariseCalls(calls: CallRecord[]): View["costs"] {
  const map = new Map<string, { provider: string; job: string; calls: number; failed: number; costMicros: number }>();
  for (const c of calls) {
    const k = `${c.job}|${c.providerId}`;
    const e = map.get(k) ?? { provider: c.providerId, job: c.job, calls: 0, failed: 0, costMicros: 0 };
    e.calls++;
    if (c.status !== "completed") e.failed++;
    e.costMicros += c.costMicros;
    map.set(k, e);
  }
  return { byProvider: [...map.values()].sort((a, b) => b.costMicros - a.costMicros), recent: [...calls].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 25) };
}

/** Everything a page needs, computed from the stored state. Free: makes no looot call. */
export async function getView(): Promise<View> {
  const { state, config, looot } = await open();
  const feed = buildFeed(state.visits, state.resolutions, state.companies, config);
  const quote = quotePending(state, config, Math.round(config.spendCapUsd * 1_000_000), new Date());
  const oldest = state.visits.reduce<string | null>((m, v) => (m === null || v.ts < m ? v.ts : m), null);
  return {
    demo: isDemo(),
    hasToken: looot !== null,
    config,
    feed,
    pendingIps: Object.keys(state.pendingIps).length,
    quote,
    spentMicros: state.calls.filter((c) => c.job !== PERSON_IDENTIFY_JOB).reduce((n, c) => n + c.costMicros, 0),
    costs: summariseCalls(state.calls),
    retention: { days: config.retentionDays, oldest },
    person: buildPersonView(state, config),
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

/** Free. Stores one visit from the tracking snippet. Person-level never sees a plain page view. */
export async function collectVisit(ip: string, path: string, referrer?: string) {
  const { state, config, save } = await open();
  const { visits } = parseVisits(`ip,path,referrer\n${ip},${path.replace(/[",\n]/g, "")},${(referrer ?? "").replace(/[",\n]/g, "")}\n`, "csv");
  addVisits(state, visits, config);
  save();
}

/** Free. A person-level event from the snippet: no company-level visit is stored. A no-op while the feature is off. */
export async function collectPerson(person: VisitSignals) {
  const { state, config, save } = await open();
  if (!queueForPerson(state, config, person)) return;
  save();
}

/** Queues one view for person-level and runs the hourly automatic deletion. Returns false when the feature is off and nothing was touched. */
function queueForPerson(state: State, config: RevealConfig, person: VisitSignals): boolean {
  if (!isPersonLevelActive(config)) return false;
  const now = new Date();
  queuePersonVisit(state, config, person, now);
  if (!state.person?.lastPurge || now.getTime() - new Date(state.person.lastPurge).getTime() > 3_600_000) purgePerson(state, config, now);
  return true;
}

/** Free. The snippet reports that the browser sent GPC or DNT. Nothing but the reason and the time is recorded. No address, no id. */
export async function recordBrowserSignal(reason: "gpc" | "dnt") {
  const { state, config, save } = await open();
  if (!isPersonLevelActive(config)) return;
  const last = state.person?.audit.at(-1);
  const now = new Date();
  // A page that reloads should not fill the log: one row per reason per minute.
  if (last && last.kind === "skipped" && last.outcome === reason && now.getTime() - new Date(last.at).getTime() < 60_000) return;
  addAudit(state, { at: now.toISOString(), kind: "skipped", supplier: "-", outcome: reason, why: reason === "gpc" ? "The browser sent Global Privacy Control." : "The browser sent Do Not Track.", costMicros: 0 });
  save();
}

/** Paid. Runs the queued person-level visitors, stopping before a call that would pass the cap. */
export async function runPerson(capUsd: number | undefined) {
  const { state, config, looot, save } = await open();
  if (!isPersonLevelActive(config)) throw new Error("Person-level identification is off.");
  const cap = toMicros(capUsd ?? config.personLevel.spendCapUsd);
  const demoMode = isDemo();
  const out = await runPersonLookups(state, config, { looot, fetch: demoMode ? demoSupplierFetch : fetch, env: demoMode ? demoEnv : process.env, now: new Date(), capMicros: cap });
  save();
  return { ...out, pending: state.person?.pending.length ?? 0 };
}

/** Free. Public opt-out. Suppresses the email's hashes and deletes what is stored for them. Works whether or not the feature is on. */
export async function optOut(email: string) {
  const { state, save } = await open();
  const r = optOutEmail(state, email, new Date());
  save();
  return r;
}

/** Free. Deletes stored data for one email. With suppress it also blocks the address from being looked up again. */
export async function deleteEmail(email: string, suppress: boolean) {
  const { state, save } = await open();
  const r = deleteByEmail(state, email, { suppress }, new Date());
  save();
  return r;
}

/** Free. Adds emails, hashes and domains to the suppression list and deletes stored data for them. */
export async function addSuppression(text: string) {
  const { state, save } = await open();
  const r = importSuppression(state, text, new Date(), "import");
  save();
  return r;
}

/** Free. Takes one entry off the suppression list. */
export async function dropSuppression(kind: SuppressionEntry["kind"], value: string) {
  const { state, save } = await open();
  const ok = removeSuppression(state, kind, value);
  save();
  return ok;
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
