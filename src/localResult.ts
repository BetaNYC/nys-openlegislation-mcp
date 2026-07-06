/**
 * Helpers for serving results from the local corpus.
 *
 * Two rules, both added after the 2026-07-06 review:
 *  1. An EMPTY local result (0 items) must not shadow the live API — the
 *     corpus may simply not have synced that slice yet. Empty → fall through.
 *  2. When a local result IS served, annotate it with a `source` field that
 *     includes the last sync date, so staleness is visible to the caller.
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

/** Attach a visible provenance note to a locally-served payload. */
export async function annotateLocalResult<T extends object>(
  result: T
): Promise<T & { source: string }> {
  let synced = "unknown date";
  try {
    const state = await getSyncState();
    if (state?.last_synced_at) synced = state.last_synced_at;
  } catch {
    // provenance is best-effort; never fail a request over it
  }
  return { ...result, source: `local corpus (synced ${synced})` };
}
