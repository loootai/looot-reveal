import { ConfigSchema } from "../config";
import { assertPersonLevelAuth, type Env } from "./policy";

/** Test helper: runs the same check updateConfig runs, with a chosen environment. */
export async function updateConfigForTest(raw: unknown, env: Env): Promise<void> {
  assertPersonLevelAuth(ConfigSchema.parse(raw), env);
}
