import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_CONFIG, parseConfig, type RevealConfig } from "./config";
import { emptyState, type State } from "./state";

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
