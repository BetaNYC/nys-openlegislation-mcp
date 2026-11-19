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

import { corpusDateFor, type CorpusDate } from "./corpusDates.js";

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

/** What a keyless caller has to do to get fresher data than the corpus holds. */
export const KEYLESS_FRESHNESS_NOTE = keylessFreshnessNote("re-run the sync (`npm run sync`)");

/** The keyless note for a type, naming what refreshes it (the sync does not refresh laws,
 * members, committees or transcripts; see corpusDates.ts). */
export function keylessFreshnessNote(refresh: string): string {
  return "No NYS_LEGISLATION_API_KEY is set, so this is snapshot data and may be out " +
    "of date. For current results, set NYS_LEGISLATION_API_KEY (free: " +
    `https://legislation.nysenate.gov/register) and ${refresh}.`;
}

/**
 * Attach a visible provenance note to a locally-served payload: the date of that type of data
 * (the sync time only for the types the sync refreshes; corpusDates.ts). Without a date, a bill's.
 *
 * When `keyless`, also carry the remedy: a consuming model needs to be able to
 * tell the user *why* the data may be stale and *what to do*, not merely that a
 * sync date exists.
 */
export async function annotateLocalResult<T extends object>(
  result: T,
  keyless = false,
  date?: CorpusDate
): Promise<T & { source: string; freshness?: string }> {
  const d = date ?? (await corpusDateFor("bills"));
  const source = `local corpus (${d.words})`;
  return keyless
    ? { ...result, source, freshness: keylessFreshnessNote(d.refresh) }
    : { ...result, source };
}

/**
 * The response for an empty local result in keyless mode.
 *
 * NOT an empty payload: with no live API to confirm against, "0 rows in the
 * corpus" and "does not exist" are indistinguishable, and returning the former
 * shaped like the latter asserts something this server cannot know.
 */
export async function notInLocalCorpus(date?: CorpusDate): Promise<{
  result: string;
  source: string;
  message: string;
}> {
  const d = date ?? (await corpusDateFor("bills"));
  return {
    result: "not_found_in_local_corpus",
    source: `local corpus (${d.words})`,
    message:
      `Not found in the local corpus (${d.words}). This may mean it does ` +
      "not exist, or that the corpus has not synced that slice — the two are " +
      "indistinguishable offline. Confirming requires a live lookup: set " +
      "NYS_LEGISLATION_API_KEY (free: https://legislation.nysenate.gov/register) " +
      `and retry, or ${d.refresh} to refresh the corpus.`,
  };
}
