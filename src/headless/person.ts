import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { deleteByEmail, importSuppression, purgePerson } from "@/lib/person/engine";
import { looksLikeEmail } from "@/lib/person/hash";
import { loadConfig, loadState, saveState, statePathFromEnv } from "@/lib/store";
import type { CliDeps } from "./run";

export const PERSON_HELP = `Usage: npm run reveal -- person <command> [options]

  delete --email <address> [--suppress]   Delete everything stored for one email. With --suppress, also keep that person from being looked up again.
  suppress --email <address>              Add one email to the suppression list and delete what is stored for it.
  suppress --file <list.txt>              Add emails, SHA-256 or MD5 hashes and domains, one per line or comma.
  purge                                   Delete people, links, queued addresses and audit rows past their retention windows.
  audit [--limit <n>]                     Print the newest audit rows. Default 20.

  --config <file>   reveal.config.json. Default: reveal.config.json, else built-in.
  --state <file>    State file. Default: REVEAL_DATA, else data/reveal.json.

These commands change only the state file. They make no looot call and cost nothing.
Exit codes: 0 done, 2 usage error.`;

/** Runs a "person" subcommand. Returns the exit code. */
export async function runPersonCli(argv: string[], deps: CliDeps): Promise<number> {
  const now = deps.now ?? new Date();
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { email: { type: "string" }, file: { type: "string" }, suppress: { type: "boolean", default: false }, limit: { type: "string" }, config: { type: "string" }, state: { type: "string" }, help: { type: "boolean", default: false } } });
  } catch (e) {
    deps.err(`${(e as Error).message}\n\n${PERSON_HELP}`);
    return 2;
  }
  const { values: a, positionals } = parsed;
  const cmd = positionals[0];
  if (a.help || !cmd) return deps.out(PERSON_HELP), a.help ? 0 : 2;
  const statePath = a.state ? resolve(a.state) : statePathFromEnv(deps.env);
  const state = loadState(statePath);
  let config;
  try {
    config = loadConfig(resolve(a.config ?? "reveal.config.json"));
  } catch (e) {
    deps.err(`The config is not valid: ${(e as Error).message}`);
    return 2;
  }

  if (cmd === "delete") {
    if (!a.email || !looksLikeEmail(a.email)) return deps.err(`--email needs an email address.\n\n${PERSON_HELP}`), 2;
    const r = deleteByEmail(state, a.email, { suppress: a.suppress === true }, now);
    saveState(statePath, state);
    deps.out(`Deleted ${r.people} stored people, ${r.links} links and ${r.pending} queued lookups.${a.suppress ? " The email is on the suppression list." : " The email is not on the suppression list; use --suppress to keep it from being looked up again."}`);
    return 0;
  }
  if (cmd === "suppress") {
    let text = "";
    if (a.email) text = a.email;
    else if (a.file) {
      if (!existsSync(a.file)) return deps.err(`No file at ${a.file}`), 2;
      text = readFileSync(a.file, "utf8");
    } else return deps.err(`suppress needs --email or --file.\n\n${PERSON_HELP}`), 2;
    const r = importSuppression(state, text, now, "import");
    saveState(statePath, state);
    deps.out(`Added ${r.added} entries, skipped ${r.skipped} lines. Deleted ${r.deleted.people} stored people.`);
    return 0;
  }
  if (cmd === "purge") {
    const r = purgePerson(state, config, now);
    saveState(statePath, state);
    deps.out(`Removed ${r.people} people, ${r.links} links, ${r.pending} queued lookups and ${r.audit} audit rows.`);
    return 0;
  }
  if (cmd === "audit") {
    const limit = a.limit === undefined ? 20 : Number(a.limit);
    if (!Number.isInteger(limit) || limit < 1) return deps.err("--limit must be a whole number."), 2;
    const rows = [...(state.person?.audit ?? [])].reverse().slice(0, limit);
    deps.out(rows.length === 0 ? "The audit log is empty." : rows.map((r) => `${r.at}  ${r.kind}  ${r.outcome}  ${r.supplier}  ${r.country ?? "-"}  $${(r.costMicros / 1_000_000).toFixed(4)}  ${r.why}`).join("\n"));
    return 0;
  }
  deps.err(`Unknown person command "${cmd}".\n\n${PERSON_HELP}`);
  return 2;
}
