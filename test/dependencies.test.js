// Tests for dependency declaration correctness.
//
// History: better-sqlite3 started in optionalDependencies, was moved to regular
// dependencies (so `--omit=optional` installs wouldn't crash scripts/sync.js),
// and was moved BACK to optionalDependencies in the 2026-07-06 fix round. The
// deciding failure mode: as a regular dependency, a failed native build kills
// `npm install` / `npx @betanyc/nys-openlegislation-mcp` entirely, taking down
// the whole server even though src/db.ts has a dynamic-import fallback that
// runs fine in pure-API mode. As an optional dependency, the server always
// installs and runs; only the corpus scripts require the module, and both
// scripts/sync.js and scripts/fetch-data.js now import it dynamically and exit
// with a clear "npm install better-sqlite3" message when it is missing.
//
// Hermetic: reads package.json / package-lock.json / script sources from disk;
// no network, no key.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));

test("better-sqlite3 is an optional dependency, not a regular one", () => {
  assert.ok(
    pkg.optionalDependencies && pkg.optionalDependencies["better-sqlite3"],
    "better-sqlite3 must be in optionalDependencies so a failed native build cannot break the npx server install"
  );
  assert.ok(
    !pkg.dependencies || !pkg.dependencies["better-sqlite3"],
    "better-sqlite3 must NOT also be a regular dependency"
  );
});

test("better-sqlite3 declared range carries a major ceiling", () => {
  const range = pkg.optionalDependencies["better-sqlite3"];
  assert.match(
    range,
    /^\^12\./,
    `expected a ^12.x range with a major ceiling, got ${range}`
  );
});

test("corpus scripts import better-sqlite3 dynamically with a clear failure message", () => {
  for (const script of ["scripts/sync.js", "scripts/fetch-data.js"]) {
    const src = readFileSync(join(root, script), "utf8");
    assert.ok(
      !/^import\s+Database\s+from\s+"better-sqlite3"/m.test(src),
      `${script} must not hard-import better-sqlite3 (it is optional)`
    );
    assert.match(
      src,
      /await import\("better-sqlite3"\)/,
      `${script} must dynamically import better-sqlite3`
    );
    assert.match(
      src,
      /npm install better-sqlite3/,
      `${script} must tell the user how to install better-sqlite3 when missing`
    );
  }
});

test("src/db.ts wraps the better-sqlite3 import so the server degrades to API-only", () => {
  const src = readFileSync(join(root, "src", "db.ts"), "utf8");
  assert.match(src, /await import\("better-sqlite3"\)/);
  assert.match(
    src,
    /catch\s*\{[\s\S]{0,80}?return null/,
    "db.ts must return null (pure API mode) when better-sqlite3 is unavailable"
  );
});

test("engines floor matches better-sqlite3 v12 support (Node >= 20)", () => {
  assert.equal(pkg.engines.node, ">=20");
});

test("lockfile version matches the manifest version", () => {
  assert.equal(lock.version, pkg.version, "package-lock.json version drifted from package.json");
  assert.equal(
    lock.packages[""].version,
    pkg.version,
    "package-lock.json packages[\"\"].version drifted from package.json"
  );
});

test("lockfile root dependency blocks match the manifest", () => {
  assert.deepEqual(
    lock.packages[""].dependencies,
    pkg.dependencies,
    "package-lock.json packages[\"\"].dependencies is out of sync — run `npm install`"
  );
  assert.deepEqual(
    lock.packages[""].optionalDependencies,
    pkg.optionalDependencies,
    "package-lock.json packages[\"\"].optionalDependencies is out of sync — run `npm install`"
  );
});
