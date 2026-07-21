/**
 * Helpers for serving results from the local corpus.
 *
 * Two rules, both added after the 2026-07-06 review:
 *  1. An EMPTY local result (0 items) must not shadow the live API — the
 *     corpus may simply not have synced that slice yet. Empty → fall through.
 *  2. When a local result IS served, annotate it with a `source` field that
 *     includes the last sync date, so staleness is visible to the caller.
 *
 * Rule 1 holds only while there IS a live API to fall through to. Keyless
 * (local-only) mode has none, so an empty result there is not a fall-through
 * and must not be returned bare — it would answer "does this exist?" with a
 * silent no that the corpus cannot actually support. See `notInLocalCorpus`
 * and issue #13.
 */

import { getSyncState } from "./db.js";

/** True when a local result is empty (no rows) and should fall through to live. */
export function isEmptyLocalResult(result: unknown): boolean {
  if (result == null) return true;
  if (Array.isArray(result)) return result.length === 0;
  if (typeof result === "object") {
    const items = (result as { items?: unknown }).items;
    if (Array.isArray(items)) return items.length === 0;
  }
  return false;
}

/** Last corpus sync timestamp, or "unknown date". Provenance is best-effort. */
async function syncedAt(): Promise<string> {
  try {
    const state = await getSyncState();
    if (state?.last_synced_at) return state.last_synced_at;
  } catch {
    // never fail a request over provenance
  }
  return "unknown date";
}

/** What a keyless caller has to do to get fresher data than the corpus holds. */
export const KEYLESS_FRESHNESS_NOTE =
  "No NYS_LEGISLATION_API_KEY is set, so this is snapshot data and may be out " +
  "of date. For current results, set NYS_LEGISLATION_API_KEY (free: " +
  "https://legislation.nysenate.gov/register) and re-run the sync " +
  "(`npm run sync`).";

/**
 * Attach a visible provenance note to a locally-served payload.
 *
 * When `keyless`, also carry the remedy: a consuming model needs to be able to
 * tell the user *why* the data may be stale and *what to do*, not merely that a
 * sync date exists.
 */
export async function annotateLocalResult<T extends object>(
  result: T,
  keyless = false
): Promise<T & { source: string; freshness?: string }> {
  const source = `local corpus (synced ${await syncedAt()})`;
  return keyless
    ? { ...result, source, freshness: KEYLESS_FRESHNESS_NOTE }
    : { ...result, source };
}

/**
 * The response for an empty local result in keyless mode.
 *
 * NOT an empty payload: with no live API to confirm against, "0 rows in the
 * corpus" and "does not exist" are indistinguishable, and returning the former
 * shaped like the latter asserts something this server cannot know.
 */
export async function notInLocalCorpus(): Promise<{
  result: string;
  source: string;
  message: string;
}> {
  const synced = await syncedAt();
  return {
    result: "not_found_in_local_corpus",
    source: `local corpus (synced ${synced})`,
    message:
      `Not found in the local corpus (synced ${synced}). This may mean it does ` +
      "not exist, or that the corpus has not synced that slice — the two are " +
      "indistinguishable offline. Confirming requires a live lookup: set " +
      "NYS_LEGISLATION_API_KEY (free: https://legislation.nysenate.gov/register) " +
      "and retry, or re-run `npm run sync` to refresh the corpus.",
  };
}
