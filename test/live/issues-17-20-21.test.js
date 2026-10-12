// Live regression checks for issues #20, #21 and #17.
//
// THIS FILE MAKES REAL CALLS (three read-only GETs, spaced >1s apart) to the
// NYS Open Legislation API. Run it deliberately with `npm run test:live`.
// The facts asserted were observed live on 2026-10-11:
//   - S5711 (2025) has one FLOOR vote, returned inside the bill record (#20);
//   - /bills/2025/search?term=lobbying returns only 2025 bills (#21);
//   - "GONZALEZ" in the 2025 Senate is Kristen Gonzalez, SD 59, alone (#17).

import { test } from "node:test";
import assert from "node:assert/strict";

import { getBillVotes, searchBills } from "../../dist/bills.js";
import { searchMembers } from "../../dist/members.js";

const API_KEY = process.env.NYS_LEGISLATION_API_KEY;
const skip = API_KEY ? false : "NYS_LEGISLATION_API_KEY not set — see test/live/search.test.js precondition";
const pause = () => new Promise((r) => setTimeout(r, 1100));

test("live #20: get_bill_votes returns a bill's recorded votes, not a 404", { skip }, async () => {
  const votes = await getBillVotes(API_KEY, 2025, "S5711");
  assert.ok(votes.size >= 1, "S5711 (2025) has a recorded floor vote");
  assert.ok(votes.items.some((v) => v.voteType === "FLOOR"));
  await pause();
});

test("live #21: search_bills with session_year returns only that session", { skip }, async () => {
  const res = await searchBills(API_KEY, "lobbying", 2025, 10);
  assert.ok(res.items.length > 0);
  for (const item of res.items) assert.equal(item.result.session, 2025);
  await pause();
});

test("live #17: a Senate-scoped member search excludes Assembly members", { skip }, async () => {
  const res = await searchMembers(API_KEY, "GONZALEZ", 2025, "senate");
  assert.ok(res.items.length >= 1);
  for (const m of res.items) assert.equal(m.chamber, "SENATE");
  assert.ok(res.items.some((m) => m.fullName === "Kristen Gonzalez"));
});
