/**
 * Shared pagination and bill-id helpers for the corpus scripts.
 *
 * NYS Open Legislation pagination facts (verified live 2026-07-06):
 *  - `offset` is 1-BASED (docs call it offsetStart). offset=0 and offset=1
 *    both start at the first row, so advancing by `limit` from 0 re-fetches
 *    the boundary row on every page.
 *  - The envelope's top-level `total` is the total match count;
 *    `result.size` is just the current page size.
 */

/** First-page offset — the API's offsets are 1-based. */
export const START_OFFSET = 1;

/** Offset for the page after a page of `pageLength` items starting at `offset`. */
export function nextOffset(offset, pageLength) {
  return offset + pageLength;
}

/**
 * True when pagination should stop: short page, or we've fetched everything
 * per the envelope's top-level `total`.
 */
export function isLastPage(pageLength, limit, fetchedCount, total) {
  if (pageLength < limit) return true;
  if (total != null && fetchedCount >= total) return true;
  return false;
}

/**
 * Strip a trailing amendment letter from a print number.
 * "S1234A" -> "S1234"; "S1234" -> "S1234". Update feeds and amended bills
 * carry the active amendment letter, while the corpus is keyed by the base
 * print number.
 */
export function basePrintNo(printNo) {
  if (typeof printNo !== "string") return printNo;
  const m = printNo.toUpperCase().match(/^([SAJKBCELR]\d+)[A-Z]?$/);
  return m ? m[1] : printNo.toUpperCase();
}
