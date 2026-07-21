// Live smoke test for the `search` tool's per-type routes.
//
// THIS FILE MAKES REAL CALLS to the NYS Open Legislation API. It lives in
// test/live/ so the default `npm test` glob (test/*.test.js) cannot reach it;
// run it deliberately with `npm run test:live`. One read-only GET per searchable
// type — this would have caught the dead unified `/search` route the moment it
// shipped, because an HTML 404 fails apiFetch loudly.
//
// It used to sit in test/ and skip itself when no key was present. That guard
// keyed off key PRESENCE as a stand-in for INTENT, so on a machine configured to
// run this MCP a plain `npm test` quietly made live requests (issue #14).
//
// Missing key here is a FAILURE, not a skip: reaching this file means the caller
// asked for the live suite, and a silent skip would read as a pass.

import { test } from "node:test";
import assert from "node:assert/strict";

import { search, SEARCHABLE_TYPES } from "../../dist/search.js";

const API_KEY = process.env.NYS_LEGISLATION_API_KEY;

const MISSING_KEY = `NYS_LEGISLATION_API_KEY is not set, so the live tests cannot run.

Get a free key: https://legislation.nysenate.gov/register
Then:           export NYS_LEGISLATION_API_KEY="your-key"

See README § API key — this project uses a shell export or your MCP client's
env block, not a .env file. To run only the offline tests, use \`npm test\`.`;

test("precondition: an API key is available for the live suite", () => {
  assert.ok(API_KEY, MISSING_KEY);
});

// The smoke tests themselves still skip without a key, so the output is one
// clear precondition failure rather than N authentication errors.
const skip = API_KEY ? false : "no API key — see the precondition failure above";

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
