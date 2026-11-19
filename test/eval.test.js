// The evaluation set (eval/questions.json, #40) runs offline in the default suite: a question
// that stops getting its known answer fails here. `npm run eval` runs the same set and saves the
// results to eval/runs/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runEval, LIVE_SOURCE_LINE } from "../eval/run.js";

test("the evaluation set has at least 10 questions, each with a known answer", () => {
  const { questions } = JSON.parse(readFileSync("eval/questions.json", "utf8"));
  assert.ok(questions.length >= 10, `${questions.length} questions`);
  for (const q of questions) assert.ok(q.q && q.answer && q.steps?.length, q.id);
});

test("every question in the evaluation set gets its known answer", async () => {
  const failed = (await runEval()).filter((r) => !r.pass);
  assert.deepEqual(failed, []);
});

test("the eval's source check takes only the live wording and the Senate's link", () => {
  const good = "BetaNYC modified this data: passed on as the Senate's Open Legislation API returns it, with additions that change no value: " +
    "the API's paging totals, links to nysenate.gov, and an empty vote list for a bill with no votes. This copy should not be considered the official record. " +
    "Fetched from the source for this answer at 2026-11-18 13:05 EST (New York time). Official record: Open Legislation API (New York State Senate), https://legislation.nysenate.gov/";
  assert.match(good, LIVE_SOURCE_LINE);
  for (const junk of [
    "Source: Foo New York State Senate. As of whenever Link: https://evil.example/",
    good.replace("https://legislation.nysenate.gov/", "https://evil.example/"),
    good.replace("2026-11-18 13:05 EST", "whenever"),
    good.replace("Fetched from the source for this answer at", "As of"),
    good.replace(" (New York time)", ""),
  ]) assert.doesNotMatch(junk, LIVE_SOURCE_LINE, junk);
});
