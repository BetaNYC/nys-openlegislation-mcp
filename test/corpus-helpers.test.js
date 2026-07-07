// Regression tests for the corpus-script helpers and local-result fallthrough
// (2026-07-06 review).
//
// Hermetic: no network, no key, no corpus.db.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  START_OFFSET,
  nextOffset,
  isLastPage,
  basePrintNo,
} from "../scripts/lib/api-helpers.js";
import { flattenLawTree } from "../scripts/lib/law-tree.js";
import { isEmptyLocalResult, annotateLocalResult } from "../dist/localResult.js";

// ─── Law tree flattening ───────────────────────────────────────────────────────
// A minimal law tree in the EXACT shape returned by GET /api/3/laws/{lawId}
// (confirmed live 2026-07-07): child documents nest under `documents.items`,
// a `{ items, size }` wrapper — there is no `children` array. This mirrors the
// real CHAPTER → PART/TITLE/ARTICLE → SECTION hierarchy in miniature.
function sampleLawTree() {
  const section = (loc, title) => ({
    lawId: "PEN",
    locationId: loc,
    title,
    docType: "SECTION",
    activeDate: "2014-09-04",
    documents: { items: [], size: 0 },
  });
  // result.documents (the root node passed by fetch-data.js)
  return {
    lawId: "PEN",
    locationId: "-CH40",
    title: "Penal",
    docType: "CHAPTER",
    activeDate: "2014-09-04",
    documents: {
      size: 1,
      items: [
        {
          lawId: "PEN",
          locationId: "P1",
          title: "General Provisions",
          docType: "PART",
          activeDate: "2014-09-04",
          documents: {
            size: 2,
            items: [
              {
                lawId: "PEN",
                locationId: "A1",
                title: "General Purposes",
                docType: "ARTICLE",
                activeDate: "2014-09-04",
                documents: {
                  size: 2,
                  items: [section("1.00", "Short title"), section("1.05", "General purposes")],
                },
              },
              section("5.00", "Construction"),
            ],
          },
        },
      ],
    },
  };
}

test("flattenLawTree recurses through documents.items, not children", () => {
  const rows = flattenLawTree(sampleLawTree(), "PEN");
  // Root CHAPTER + PART + ARTICLE + 3 SECTIONs = 6 nodes.
  assert.strictEqual(rows.length, 6);
  const sections = rows.filter((r) => r.docType === "SECTION").map((r) => r.locationId);
  // Deeply-nested sections must be reached (the `children` bug returned only the root).
  assert.deepEqual(sections.sort(), ["1.00", "1.05", "5.00"]);
  assert.ok(rows.every((r) => r.lawId === "PEN"));
});

test("flattenLawTree ignores a `children` array (the old, wrong key)", () => {
  // A node shaped the way the buggy code expected: children instead of documents.items.
  const wrongShape = {
    locationId: "-CH40",
    docType: "CHAPTER",
    children: [{ locationId: "X1", docType: "SECTION", children: [] }],
  };
  const rows = flattenLawTree(wrongShape, "PEN");
  // Only the root is captured — proves `children` is never used for recursion,
  // which is exactly the collapse the fix prevents on the real API shape.
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].locationId, "-CH40");
});

test("flattenLawTree tolerates empty and nullish nodes", () => {
  assert.deepEqual(flattenLawTree(null, "PEN"), []);
  assert.deepEqual(flattenLawTree(undefined, "PEN"), []);
  assert.deepEqual(flattenLawTree({ documents: { items: [], size: 0 } }, "PEN"), []);
});

// ─── 1-based offset math ──────────────────────────────────────────────────────
// Verified live 2026-07-06: offset=2 returns offsetStart=2 — offsets are
// 1-based, so advancing by `limit` from 0 duplicated one row per page.

test("pagination starts at offset 1, not 0", () => {
  assert.strictEqual(START_OFFSET, 1);
});

test("next page starts exactly one past the last fetched row (no overlap)", () => {
  // Page 1: offset 1, 1000 rows => rows 1..1000. Next page must start at 1001.
  assert.strictEqual(nextOffset(START_OFFSET, 1000), 1001);
  // Page 2: offset 1001, 1000 rows => rows 1001..2000. Next at 2001.
  assert.strictEqual(nextOffset(1001, 1000), 2001);
});

test("isLastPage uses the envelope total, not result.size", () => {
  // Full page but everything fetched per top-level total => stop.
  assert.strictEqual(isLastPage(1000, 1000, 2000, 2000), true);
  // Full page, more remaining => continue.
  assert.strictEqual(isLastPage(1000, 1000, 1000, 2500), false);
  // Short page always stops, even without a total.
  assert.strictEqual(isLastPage(3, 1000, 1003, null), true);
  // Full page with no total: keep going until a short page.
  assert.strictEqual(isLastPage(1000, 1000, 1000, null), false);
});

// ─── printNo normalization ────────────────────────────────────────────────────
// Amended bills report printNo with the active amendment letter (S1234A)
// while corpus rows are keyed by the base print number (S1234).

test("basePrintNo strips a trailing amendment letter", () => {
  assert.strictEqual(basePrintNo("S1234A"), "S1234");
  assert.strictEqual(basePrintNo("A5678C"), "A5678");
});

test("basePrintNo leaves base print numbers unchanged", () => {
  assert.strictEqual(basePrintNo("S1234"), "S1234");
  assert.strictEqual(basePrintNo("A5678"), "A5678");
});

test("basePrintNo uppercases and tolerates odd input", () => {
  assert.strictEqual(basePrintNo("s1234a"), "S1234");
  assert.strictEqual(basePrintNo("J100"), "J100");
});

// ─── Empty-local fallthrough ──────────────────────────────────────────────────
// An empty local result (0 items) must fall through to the live API instead
// of shadowing it; a served local result carries a `source` provenance note.

test("empty item lists are treated as empty (fall through to live)", () => {
  assert.strictEqual(isEmptyLocalResult({ items: [], size: 0 }), true);
  assert.strictEqual(isEmptyLocalResult([]), true);
  assert.strictEqual(isEmptyLocalResult(null), true);
  assert.strictEqual(isEmptyLocalResult(undefined), true);
});

test("non-empty local results are served", () => {
  assert.strictEqual(isEmptyLocalResult({ items: [{ printNo: "S1" }], size: 1 }), false);
  assert.strictEqual(isEmptyLocalResult({ printNo: "S1", title: "x" }), false);
});

test("annotateLocalResult appends a local-corpus source note", async () => {
  const annotated = await annotateLocalResult({ items: [1], size: 1 });
  assert.match(annotated.source, /^local corpus \(synced .+\)$/);
  assert.deepEqual(annotated.items, [1]);
});
