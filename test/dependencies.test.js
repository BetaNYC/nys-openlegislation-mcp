// Tests for dependency declaration correctness.
//
// Regression target: better-sqlite3 is imported unconditionally by the corpus
// tooling — `scripts/sync.js` and `scripts/fetch-data.js` do
// `import Database from "better-sqlite3"` at the top level, and these scripts
// run in production via the workspace `/mcp-refresh-data` flow. It was declared
// only in `optionalDependencies`, so a production install that omits optional
// deps (`npm ci --omit=optional`) would not install it and the sync scripts
// would crash on import. These tests assert it is a regular dependency and that
// the committed lockfile stays in sync with the manifest.
//
// Hermetic: reads package.json / package-lock.json from disk; no network, no key.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));

test("better-sqlite3 is a regular dependency, not optional", () => {
  assert.ok(
    pkg.dependencies && pkg.dependencies["better-sqlite3"],
    "better-sqlite3 must be declared in dependencies (the sync scripts hard-import it)"
  );
  assert.ok(
    !pkg.optionalDependencies || !pkg.optionalDependencies["better-sqlite3"],
    "better-sqlite3 must NOT be in optionalDependencies — an --omit=optional install would skip it and crash scripts/sync.js"
  );
});

test("better-sqlite3 declared range carries a major ceiling", () => {
  const range = pkg.dependencies["better-sqlite3"];
  // caret on a 12.x version bounds below 13.0.0 — the engineering-standards
  // "every dependency gets a `<` ceiling" rule.
  assert.match(
    range,
    /^\^12\./,
    `expected a ^12.x range with a major ceiling, got ${range}`
  );
});

test("lockfile version matches the manifest version", () => {
  assert.equal(lock.version, pkg.version, "package-lock.json version drifted from package.json");
  assert.equal(
    lock.packages[""].version,
    pkg.version,
    "package-lock.json packages[\"\"].version drifted from package.json"
  );
});

test("lockfile root dependencies match the manifest dependencies", () => {
  assert.deepEqual(
    lock.packages[""].dependencies,
    pkg.dependencies,
    "package-lock.json packages[\"\"].dependencies is out of sync with package.json dependencies — run `npm install` to reconcile"
  );
  assert.ok(
    !lock.packages[""].optionalDependencies,
    "lockfile still carries an optionalDependencies block — reconcile with `npm install`"
  );
});
