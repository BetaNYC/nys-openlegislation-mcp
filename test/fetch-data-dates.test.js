// scripts/fetch-data.js saves a type's download date (sync_state.fetched_at_<type>) only when the
// whole download worked. fetchLaws and fetchTranscripts carry on past a failed item; a type with
// any failed item keeps its earlier date (or none), and the run exits non-zero saying how many
// items failed. Offline: every request goes to a fake fetch in a preload; the key is a dummy.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let Database = null;
try {
  ({ default: Database } = await import("better-sqlite3"));
} catch {
  Database = null;
}
const skip = Database ? false : "better-sqlite3 unavailable — fetch-data.js needs it";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "nys-fetch-dates-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

// FAKE_FAIL: "all" fails every request; "some" fails the paths matching FAKE_FAIL_PATH; "none".
const PRELOAD = join(tmp, "fake-api.mjs");
writeFileSync(PRELOAD, `
const mode = process.env.FAKE_FAIL;
const failPath = process.env.FAKE_FAIL_PATH ? new RegExp(process.env.FAKE_FAIL_PATH) : null;
const ok = (result) => ({ ok: true, status: 200, statusText: "OK", json: async () => ({ success: true, message: "", total: result.items?.length ?? null, result }) });
const law = (lawId) => ({ lawId, name: lawId, lawType: "CONSOLIDATED" });
const tree = (lawId) => ({ lawId, documents: { lawId, locationId: "-CH1", docType: "CHAPTER", title: "t", documents: { items: [
  { lawId, locationId: "1", docType: "SECTION", title: "s1", documents: { items: [] } } ] } } });
globalThis.fetch = async (url) => {
  const p = new URL(String(url)).pathname.replace(/^\\/api\\/3/, "");
  if (mode === "all" || (mode === "some" && failPath && failPath.test(p))) {
    return { ok: false, status: 500, statusText: "Server Error", json: async () => ({}) };
  }
  if (p === "/laws") return ok({ items: [law("ABC"), law("DEF")] });
  let m;
  if ((m = /^\\/laws\\/([A-Z]+)$/.exec(p))) return ok(tree(m[1]));
  if (/^\\/(transcripts|hearings)\\/\\d{4}$/.test(p)) return ok({ items: [] });
  throw new Error("unexpected request " + p);
};
`);

function fetchData(types, fail, failPath = "") {
  const db = join(tmp, `${types}-${fail}-${Math.random().toString(36).slice(2)}.db`);
  const year = new Date().getFullYear();
  const run = spawnSync(process.execPath, [
    "--import", pathToFileURL(PRELOAD).href, join(ROOT, "scripts", "fetch-data.js"),
    `--types=${types}`, `--start-year=${year}`, "--delay-ms=0",
  ], {
    env: { ...process.env, NYS_LEGISLATION_API_KEY: "not-a-real-key-offline", NYS_CORPUS_DB: db, FAKE_FAIL: fail, FAKE_FAIL_PATH: failPath },
    encoding: "utf8",
  });
  const conn = new Database(db, { readonly: true });
  const state = Object.fromEntries(conn.prepare("SELECT key, value FROM sync_state").all().map((r) => [r.key, r.value]));
  conn.close();
  return { ...run, state };
}

const CASES = {
  laws: { some: "^/laws/DEF$" },
  transcripts: { some: "^/hearings/" },
};

for (const [type, { some }] of Object.entries(CASES)) {
  test(`${type}: every request fails: no date saved, non-zero exit, a plain count`, { skip }, () => {
    const r = fetchData(type, "all");
    assert.notEqual(r.status, 0, "a failed download must not exit 0");
    assert.equal(r.state[`fetched_at_${type}`], undefined, "old data must not claim today's date");
    assert.match(r.stderr, new RegExp(`✖ \\d+ item\\(s\\) could not be downloaded \\(${type}: \\d+\\)`));
    assert.match(r.stderr, new RegExp(`--types=${type}`), "says how to try again");
  });

  test(`${type}: some requests fail: no date saved, non-zero exit`, { skip }, () => {
    const r = fetchData(type, "some", some);
    assert.notEqual(r.status, 0);
    assert.equal(r.state[`fetched_at_${type}`], undefined);
    assert.match(r.stderr, new RegExp(`✖ 1 item\\(s\\) could not be downloaded \\(${type}: 1\\)`));
  });

  test(`${type}: nothing fails: the date is saved and the exit code is 0`, { skip }, () => {
    const r = fetchData(type, "none");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.state[`fetched_at_${type}`] ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-0[45]:00$/);
    assert.doesNotMatch(r.stderr, /could not be downloaded/);
  });
}
