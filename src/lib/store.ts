import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DEFAULT_CONFIG, parseConfig, type RevealConfig } from "./config";
import { emptyState, type State } from "./state";

/** The one state file the web UI and the CLI share. Override with REVEAL_DATA. */
export const DEFAULT_STATE_PATH = "data/reveal.json";
/** Where the CLI kept its state before the two were joined. Moved to the shared path on first use. */
export const LEGACY_CLI_STATE_PATH = "state/reveal.json";

/** Absolute state path: REVEAL_DATA if set, else data/reveal.json. */
export function statePathFromEnv(env: Record<string, string | undefined> = process.env): string {
  return resolve(/* turbopackIgnore: true */ env.REVEAL_DATA || DEFAULT_STATE_PATH);
}

/** If `path` is the default and does not exist but the old CLI file does, moves the old file there. Returns true when it moved. */
export function migrateLegacyState(path: string, legacy: string = resolve(/* turbopackIgnore: true */ LEGACY_CLI_STATE_PATH)): boolean {
  if (existsSync(path) || !existsSync(legacy) || path === legacy) return false;
  mkdirSync(dirname(path), { recursive: true });
  renameSync(legacy, path);
  return true;
}

/** Reads the state file. A missing file is an empty state. */
export function loadState(path: string): State {
  if (!existsSync(path)) return emptyState();
  const s = JSON.parse(readFileSync(path, "utf8")) as State;
  return s.version === 1 ? s : emptyState();
}

/** Writes the state through a temp file so a crash never leaves half a file. */
export function saveState(path: string, state: State): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state)}\n`);
  renameSync(tmp, path);
}

/** Reads reveal.config.json, or returns the default ICP when there is no file. */
export function loadConfig(path: string): RevealConfig {
  return existsSync(path) ? parseConfig(readFileSync(path, "utf8")) : DEFAULT_CONFIG;
}

export function saveConfig(path: string, config: RevealConfig): void {
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}
