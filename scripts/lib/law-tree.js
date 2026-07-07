// scripts/lib/law-tree.js
//
// Shared, side-effect-free helper for walking a NYS Open Legislation law tree.
// Extracted from fetch-data.js so it can be unit-tested hermetically.
//
// API shape (confirmed live against GET /api/3/laws/{lawId} on 2026-07-07):
//   result.documents                      → the root node (e.g. the CHAPTER)
//   node = { lawId, locationId, title, docType, activeDate, documents, ... }
//   node.documents = { items: [ <child node>, ... ], size: N }   ← the wrapper
//
// Child documents are nested under `documents.items` — NOT a `children` array.
// The previous implementation recursed via `node.children ?? []`, which is
// always `[]` for this API, so every law body collapsed to just its root node
// (137 rows total across all bodies instead of tens of thousands of sections).

/**
 * Recursively flatten a law document tree into a list of section-metadata rows.
 *
 * @param {object|null|undefined} node  A law tree node (root is result.documents).
 * @param {string} lawId                The law body id (e.g. "PEN").
 * @param {Array}  [acc]                Accumulator (internal).
 * @returns {Array<{lawId:string, locationId:string, title:*, docType:*, activeDate:*}>}
 */
export function flattenLawTree(node, lawId, acc = []) {
  if (!node) return acc;

  // Tolerate a `lawVersion`-wrapped node; the /laws/{id} tree nodes are not
  // wrapped, so this is a no-op there but harmless for other shapes.
  const lv = node.lawVersion ?? node;

  if (lv.locationId) {
    acc.push({
      lawId,
      locationId: lv.locationId,
      title: lv.title,
      docType: lv.docType,
      activeDate: lv.activeDate,
    });
  }

  // Children live under `documents` as a { items, size } wrapper. Accept a bare
  // array too, defensively, but never fall back to `children`.
  const childContainer = lv.documents ?? node.documents;
  const children = Array.isArray(childContainer)
    ? childContainer
    : (childContainer?.items ?? []);

  for (const child of children) {
    flattenLawTree(child, lawId, acc);
  }

  return acc;
}
