// Live smoke test for the `search` tool's per-type routes.
//
// Gated on NYS_LEGISLATION_API_KEY being present in the environment; skipped
// otherwise (CI has no key). One read-only GET per searchable type — this
// would have caught the dead unified `/search` route the moment it shipped,
// because an HTML 404 fails apiFetch loudly.

import { test } from "node:test";
import assert from "node:assert/strict";

import { search, SEARCHABLE_TYPES } from "../dist/search.js";

const API_KEY = process.env.NYS_LEGISLATION_API_KEY;
const skip = API_KEY
  ? false
  : "NYS_LEGISLATION_API_KEY not set — skipping live smoke test";

test("live: laws search for 'beaver' returns the state-animal section", { skip }, async () => {
  const results = await search(API_KEY, "beaver", "laws", undefined, 5);
  assert.ok(results.items.length > 0, "expected at least one laws hit");
  const stateAnimal = results.items.find(
    (i) => i.result?.lawId === "STL" && i.result?.title === "State animal"
  );
  assert.ok(stateAnimal, "expected STL 'State animal' (§ 79) among top laws hits for 'beaver'");
});

test("live: every searchable type's route exists (no HTML 404)", { skip }, async () => {
  for (const type of SEARCHABLE_TYPES) {
    // Any successful JSON envelope proves the route exists; hit counts vary.
    const results = await search(API_KEY, "budget", type, undefined, 1);
    assert.ok(Array.isArray(results.items), `type=${type}: expected an items array`);
  }
});
