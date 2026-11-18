// Tool annotations (#31) and the tool-list size budget (#39).

import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOLS, SERVER_INSTRUCTIONS } from "../dist/tools.js";
import { assertEveryToolAnnotated, toolListSize } from "../dist/betanyc-tools.js";

const SHARED = new Set(["whats_changed", "about_betanyc", "about_data"]);

test("every tool is annotated: read-only, with openWorldHint and a title", () => {
  assertEveryToolAnnotated(TOOLS);
  for (const t of TOOLS) {
    assert.equal(t.annotations.readOnlyHint, true, t.name);
    assert.ok(t.annotations.title, `${t.name} has no title`);
    // The Open Legislation tools may call the live API; the shared tools read this repo's files.
    assert.equal(t.annotations.openWorldHint, !SHARED.has(t.name), t.name);
  }
});

// Every tool definition is sent to the model on every turn, so its size is a cost. Measure:
// tools/list JSON plus the server instructions (shared module toolListSize, the nyc-311-mcp
// measure). Text several tools share belongs once in the instructions, not in each description.
// Raise the budget only on purpose, with a dated line here saying why.
// 2026-11-18: measured 28,077 characters (27 tools, annotations added); budget set just above.
const BUDGET_CHARS = 28_500;

test("tool definitions plus server instructions stay within the size budget", () => {
  const size = toolListSize(TOOLS, SERVER_INSTRUCTIONS);
  assert.ok(size <= BUDGET_CHARS, `tools/list JSON + instructions is ${size} characters, over the ${BUDGET_CHARS} budget`);
});
