import type { RevealConfig } from "../config";

export type Env = Record<string, string | undefined>;

/** Shortest admin password the app accepts. A shorter one counts as not set. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * open-demo: sample data, no token, no real data file. Admin pages are open and carry a badge.
 * login: an admin password is set, so every admin route needs a session.
 * setup: no usable password. Admin routes refuse to serve and /login explains what to set.
 */
export type AdminMode = "open-demo" | "login" | "setup";

export interface AdminPolicy {
  mode: AdminMode;
  /** Why the mode is "setup", in words for the setup page. */
  reason?: "no_password" | "short_password" | "demo_with_real_data";
}

export const isDemoEnv = (env: Env): boolean => env.NEXT_PUBLIC_DEMO === "1";

/** The plain password, or the scrypt hash, whichever is set. The hash wins. */
export function adminSecretFromEnv(env: Env): { kind: "hash" | "plain"; value: string } | null {
  const hash = env.REVEAL_ADMIN_PASSWORD_HASH?.trim();
  if (hash) return { kind: "hash", value: hash };
  const plain = env.REVEAL_ADMIN_PASSWORD;
  if (plain && plain.length > 0) return { kind: "plain", value: plain };
  return null;
}

/** true when an admin password (or hash) is set and long enough. */
export function isAuthConfigured(env: Env): boolean {
  const s = adminSecretFromEnv(env);
  return s !== null && (s.kind === "hash" || s.value.length >= MIN_PASSWORD_LENGTH);
}

/**
 * Decides how admin routes behave. `hasRealData` is true when a LOOOT_TOKEN or a state file exists.
 * Demo mode with real data and no password is refused, because the badge would be a lie.
 */
export function adminPolicy(env: Env, hasRealData: boolean): AdminPolicy {
  if (isAuthConfigured(env)) return { mode: "login" };
  const s = adminSecretFromEnv(env);
  if (isDemoEnv(env)) return hasRealData ? { mode: "setup", reason: "demo_with_real_data" } : { mode: "open-demo" };
  return { mode: "setup", reason: s ? "short_password" : "no_password" };
}

/** Person-level data may only be held when admin sign-in is configured. Demo uses invented people and is exempt. */
export function personLevelAllowed(env: Env): boolean {
  return isDemoEnv(env) || isAuthConfigured(env);
}

export const PERSON_LEVEL_NEEDS_AUTH = "Person-level identification needs admin sign-in. Set REVEAL_ADMIN_PASSWORD (at least 12 characters) or REVEAL_ADMIN_PASSWORD_HASH, then turn it on again.";

/** Throws when the config turns person-level on and no admin auth is set. */
export function assertPersonLevelAuth(config: RevealConfig, env: Env): void {
  if (config.personLevel.enabled && !personLevelAllowed(env)) throw new Error(PERSON_LEVEL_NEEDS_AUTH);
}
