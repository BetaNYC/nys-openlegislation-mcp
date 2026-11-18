// The evaluation set (eval/questions.json, #40) runs offline in the default suite: a question
// that stops getting its known answer fails here. `npm run eval` runs the same set and saves the
// results to eval/runs/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runEval } from "../eval/run.js";

test("the evaluation set has at least 10 questions, each with a known answer", () => {
  const { questions } = JSON.parse(readFileSync("eval/questions.json", "utf8"));
  assert.ok(questions.length >= 10, `${questions.length} questions`);
  for (const q of questions) assert.ok(q.q && q.answer && q.steps?.length, q.id);
});

test("every question in the evaluation set gets its known answer", async () => {
  const failed = (await runEval()).filter((r) => !r.pass);
  assert.deepEqual(failed, []);
});
