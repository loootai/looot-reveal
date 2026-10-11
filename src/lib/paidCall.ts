import { ledgerKey, type Ledger } from "./budget";
import { LoootError, type LoootRun, type LoootRunner } from "./looot";
import { toMicros } from "./money";

/** looot statuses where the run has ended and actualCost is final. */
const ENDED = new Set(["completed", "failed", "blocked", "stopped"]);

export interface PaidCallInput {
  looot: LoootRunner;
  /** Period budget. Leave out in demo mode and in tests that do not need it. */
  ledger?: Ledger;
  endpointId: string;
  input: Record<string, unknown>;
  /** Stable idempotency key for this call. */
  key: string;
  /** List price in micro-dollars, reserved before the call. */
  priceMicros: number;
  now: Date;
  fallback: boolean;
}

export type PaidCallResult = { refused: string; run: null } | { refused: null; run: LoootRun };

/**
 * One looot call under the period budget: reserve, call, then settle, attach or release.
 * A refusal means the call was not made. A free call (price 0) skips the reservation and records any real charge.
 * An HTTP answer from looot means the call did not run, so the reservation goes back. A network error is unknown,
 * the request may have been accepted, so the reservation stays until the hard expiry or a later reconcile settles it.
 * A run that is still going keeps its reservation. It is never counted as $0.
 */
export async function paidCall(a: PaidCallInput): Promise<PaidCallResult> {
  const { ledger, key } = a;
  const lk = ledgerKey(key);
  const reserved = Boolean(ledger) && a.priceMicros > 0;
  if (ledger && reserved) {
    const held = await ledger.reserve(lk, a.priceMicros, a.now);
    if (!held.ok) return { refused: held.message, run: null };
  }
  let run: LoootRun;
  try {
    run = await a.looot.runAndWait(a.endpointId, a.input, key, { fallback: a.fallback });
  } catch (e) {
    if (ledger && reserved && e instanceof LoootError) await ledger.release(lk);
    const err = e instanceof LoootError ? e : null;
    return { refused: null, run: { runId: "", status: "failed", error: { code: err?.code ?? "request_failed", message: (e as Error).message } } };
  }
  if (ledger) {
    if (ENDED.has(run.status)) await ledger.settle(lk, toMicros(run.actualCost), a.now);
    else if (reserved && run.runId) await ledger.attach(lk, run.runId);
  }
  return { refused: null, run };
}
