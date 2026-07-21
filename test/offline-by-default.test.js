// Guards the invariant that `npm test` never reaches the network (issue #14).
//
// The live smoke test used to live in test/ and skip itself when no API key was
// present. That guard keyed off key PRESENCE as a stand-in for INTENT: on a
// machine configured to run this MCP the key is exported, so the same `npm test`
// that is offline in CI quietly made live requests locally. Network access is
// now a directory boundary — test/live/ — rather than an environment check.
//
// Deliberately uses readdirSync rather than fs.globSync: globSync landed in Node
// 22 and this repo's engines floor is Node 20, where it is undefined. A guard
// test that throws ReferenceError on the floor version guards nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const DEFAULT_SUITE = readdirSync("test", { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith(".test.js"))
  .map((e) => e.name);

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

test("the default suite contains no file that talks to the live API", () => {
  for (const name of DEFAULT_SUITE) {
    const src = readFileSync(`test/${name}`, "utf8");
    const callsSearch = /from "\.\.\/dist\/search\.js"/.test(src);
    const readsKey = /process\.env\.NYS_LEGISLATION_API_KEY/.test(src);
    assert.ok(
      !(callsSearch && readsKey),
      `test/${name} both imports the live search path and reads the API key — ` +
        "if it can make a real request it belongs in test/live/"
    );
  }
});

test("no live test leaked back into the default glob", () => {
  const leaked = DEFAULT_SUITE.filter((n) => /live/i.test(n));
  assert.deepEqual(leaked, [], "files named *live* must live under test/live/");
});

test("test/live/ is unreachable from the default test script", () => {
  // test/*.test.js matches files directly in test/, never test/live/*.
  assert.match(pkg.scripts.test, /node --test test\/\*\.test\.js/);
  assert.doesNotMatch(pkg.scripts.test, /test\/live/);
});

test("test:live exists and targets only test/live/", () => {
  assert.ok(pkg.scripts["test:live"], "a deliberate opt-in script must exist");
  assert.match(pkg.scripts["test:live"], /node --test test\/live\/\*\.test\.js/);
});

test("neither test glob is quoted", () => {
  // node --test did not accept glob patterns as arguments until Node 22. Quoted,
  // the pattern is treated as a literal path on Node 20 and matches nothing, so
  // the suite silently runs ZERO tests and reports success. Unquoted, the shell
  // expands it and node receives literal file paths on every supported version.
  // Caught in CI by BetaNYC/nyc-record-mcp#12.
  for (const key of ["test", "test:live"]) {
    assert.doesNotMatch(
      pkg.scripts[key],
      /"/,
      `scripts.${key} must not quote its glob — a quoted glob runs zero tests on Node 20`
    );
  }
});
