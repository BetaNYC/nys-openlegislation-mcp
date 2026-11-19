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
// 2026-11-18: 28,121 after the shared conventions moved into the instructions (#42); budget unchanged.
// 2026-11-18: 28,362 after the session-year hint went back on its 11 parameters (review of #46; some
// AI apps ignore server instructions) and shared module 1.5.1; budget unchanged.
const BUDGET_CHARS = 28_500;

test("tool definitions plus server instructions stay within the size budget", () => {
  const size = toolListSize(TOOLS, SERVER_INSTRUCTIONS);
  assert.ok(size <= BUDGET_CHARS, `tools/list JSON + instructions is ${size} characters, over the ${BUDGET_CHARS} budget`);
});

// Text several tools share is said once, in the server instructions (#42).
test("shared guidance lives once in the server instructions, not in each tool", async () => {
  const { BETANYC_INSTRUCTIONS } = await import("../dist/betanyc-tools.js");
  assert.ok(SERVER_INSTRUCTIONS.endsWith(BETANYC_INSTRUCTIONS), "the shared about_data paragraph is kept");
  for (const said of ["ElasticSearch syntax", "odd year a two-year session starts", "the number of results to skip", "Every data answer ends with its source"]) {
    assert.ok(SERVER_INSTRUCTIONS.includes(said), `instructions say: ${said}`);
  }
  const everyText = (t) => [t.description, ...Object.values(t.inputSchema.properties ?? {}).map((p) => p.description ?? "")].join(" ");
  for (const t of TOOLS) {
    // The phrases moved out of the descriptions must not creep back in.
    assert.doesNotMatch(everyText(t), /boolean operators|odd-numbered|Pagination offset/, t.name);
  }
  const seen = new Map();
  for (const t of TOOLS) {
    for (const s of t.description.split(/(?<=\.)\s+/).filter((x) => x.length >= 30)) {
      assert.ok(!seen.has(s), `"${s}" is in both ${seen.get(s)} and ${t.name}: say it once in the instructions`);
      seen.set(s, t.name);
    }
  }
});

// Some AI apps ignore server instructions, so each session_year parameter carries the hint too.
test("every session_year parameter says it is an odd year, e.g. 2025", () => {
  const params = TOOLS.flatMap((t) => (t.inputSchema.properties?.session_year ? [[t.name, t.inputSchema.properties.session_year]] : []));
  assert.ok(params.length >= 10, `found ${params.length}`);
  for (const [name, p] of params) assert.match(p.description, /\(odd year, e\.g\. 2025[;)]/, name);
});
