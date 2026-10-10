import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { RevealConfig } from "@/lib/config";
import { buildFeed } from "@/lib/feed";
import type { LogFormat } from "@/lib/ingest";
import { parseVisits } from "@/lib/ingest";
import { loootFromEnv, LoootError, type LoootRunner } from "@/lib/looot";
import { toMicros, usd } from "@/lib/money";
import { addVisits, purgeOld, quotePending, resolvePending } from "@/lib/state";
import { loadConfig, loadState, migrateLegacyState, saveState, statePathFromEnv } from "@/lib/store";
import { PRICES_AS_OF } from "@/lib/sources";
import { renderCsv, renderMarkdown, renderQuote } from "./render";

export const HELP = `Usage: npm run reveal -- --input <access.log|visits.csv> [options]

  --input <file>     Access log (combined format), CSV with an ip column, or JSON lines. Required.
  --format <f>       auto (default), combined, csv, jsonl
  --config <file>    reveal.config.json (ICP, weights, lookup, retention). Default: reveal.config.json, else built-in.
  --out <dir>        Where visitors.json, visitors.csv and visitors.md go. Default: reveal-out
  --state <file>     Answers already bought, so repeat IPs are free. Default: REVEAL_DATA, else data/reveal.json (the web UI reads the same file)
  --cap <usd>        Spend cap for this run. Default: the config's spendCapUsd
  --dry-run          Print the list-price cost and make no call. Writes nothing.

Needs LOOOT_TOKEN in the environment, except with --dry-run.
Exit codes: 0 done, 1 run failed, 2 usage error.`;

export interface CliDeps {
  env: Record<string, string | undefined>;
  out: (s: string) => void;
  err: (s: string) => void;
  now?: Date;
  /** Tests pass a mock. Real runs build one from LOOOT_TOKEN. */
  looot?: LoootRunner;
}

/** Runs the headless command. Returns the exit code. */
export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const now = deps.now ?? new Date();
  let a;
  try {
    a = parseArgs({ args: argv, options: { input: { type: "string" }, format: { type: "string", default: "auto" }, config: { type: "string" }, out: { type: "string", default: "reveal-out" }, state: { type: "string" }, cap: { type: "string" }, "dry-run": { type: "boolean", default: false }, help: { type: "boolean", default: false } } }).values;
  } catch (e) {
    deps.err(`${(e as Error).message}\n\n${HELP}`);
    return 2;
  }
  if (a.help) return deps.out(HELP), 0;
  if (!a.input) return deps.err(`--input is required.\n\n${HELP}`), 2;
  if (!existsSync(a.input)) return deps.err(`No file at ${a.input}`), 2;
  if (!["auto", "combined", "csv", "jsonl"].includes(a.format as string)) return deps.err(`Unknown --format ${a.format}`), 2;

  let config: RevealConfig;
  try {
    config = loadConfig(resolve(a.config ?? "reveal.config.json"));
  } catch (e) {
    deps.err(`The config is not valid: ${(e as Error).message}`);
    return 2;
  }
  const capUsd = a.cap === undefined ? config.spendCapUsd : Number(a.cap);
  if (!Number.isFinite(capUsd) || capUsd < 0) return deps.err("--cap must be a number of dollars."), 2;
  const capMicros = toMicros(capUsd);

  const statePath = a.state ? resolve(a.state) : statePathFromEnv(deps.env);
  if (!a.state) migrateLegacyState(statePath);
  const state = loadState(statePath);
  const parsed = parseVisits(readFileSync(a.input, "utf8"), a.format as LogFormat, now);
  const s = parsed.skipped;
  deps.out(`Read ${parsed.visits.length} page views (${parsed.format}). Skipped: ${s.assets} assets, ${s.bots} bots, ${s.errors} error responses, ${s.badRows} unreadable rows.`);
  addVisits(state, parsed.visits, config, now);
  const quote = quotePending(state, config, capMicros, now);
  deps.out(renderQuote(quote, `List prices dated ${PRICES_AS_OF}. The real charge is read from each run.`));

  if (a["dry-run"]) {
    deps.out("Dry run: no looot call was made and nothing was written.");
    return 0;
  }

  let looot = deps.looot;
  if (!looot) {
    try {
      looot = loootFromEnv(deps.env);
    } catch (e) {
      if (e instanceof LoootError) return deps.err("LOOOT_TOKEN is not set. Create an agent token at https://looot.ai/settings, or use --dry-run."), 2;
      throw e;
    }
  }

  const purged = purgeOld(state, config, now);
  const result = await resolvePending(state, config, looot, capMicros, now);
  saveState(statePath, state);

  const feed = buildFeed(state.visits, state.resolutions, state.companies, config);
  const spent = state.calls.reduce((n, c) => n + c.costMicros, 0);
  const outDir = resolve(a.out as string);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "visitors.json"), `${JSON.stringify({ generatedAt: now.toISOString(), spentThisRunMicros: result.spentMicros, ...feed }, null, 2)}\n`);
  writeFileSync(join(outDir, "visitors.csv"), renderCsv(feed.companies));
  writeFileSync(join(outDir, "visitors.md"), renderMarkdown(feed, { title: `Visiting companies, ${now.toISOString().slice(0, 10)}`, spentMicros: spent }));

  deps.out(`Made ${result.calls.length} calls, spent ${usd(result.spentMicros)} this run (${usd(spent)} in total in the state file).`);
  if (result.notRun.ips.length + result.notRun.domains.length > 0) deps.out(`Stopped at the ${usd(capMicros)} cap: ${result.notRun.ips.length} IPs and ${result.notRun.domains.length} domains were not run. Run again with a higher --cap.`);
  const pending = Object.keys(state.pendingIps).length;
  if (pending > 0) deps.out(`${pending} IPs are pending (still running or not run). Run the same command again to collect them. Pending runs are never charged twice.`);
  if (purged.visits > 0) deps.out(`Retention: removed ${purged.visits} visits older than ${config.retentionDays} days.`);
  deps.out(`${feed.companies.length} companies, ${feed.companies.filter((c) => c.icp.matched).length} match the ICP. Files in ${outDir}`);
  const attempted = result.calls.length;
  if (attempted > 0 && result.calls.every((c) => c.status === "failed")) return deps.err("Every call failed."), 1;
  return 0;
}
