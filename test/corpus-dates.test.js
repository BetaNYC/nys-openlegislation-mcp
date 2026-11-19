// "As of" for an answer from the local copy is the date of THAT type of data. The nightly sync
// (scripts/sync.js) refreshes only bills, agendas and calendars, so only they get the sync time.
// Laws, members, committees and transcripts change only when scripts/fetch-data.js runs again:
// they get the time fetch-data.js recorded for that type (sync_state.fetched_at_<type>), or,
// on a copy that has no such time, an answer saying the date is not recorded and that the data
// comes from the last full download. Never the sync time. Offline: no key, fetch refuses.

import { test, beforeEach, afterEach, mock } from "node:test";
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
const skip = Database ? false : "better-sqlite3 unavailable — cannot build a fixture corpus";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "nys-corpus-dates-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));
const CORPUS = join(tmp, "corpus.db");

const SYNCED = "2026-11-17T02:00:00-05:00";
const LAWS_AT = "2026-06-01T09:00:00-04:00";
const MEMBERS_AT = "2026-06-01T10:00:00-04:00";
const OLD_BILLS_AT = "2026-05-01T09:00:00-04:00"; // older than the sync: the sync time wins for bills

if (Database) {
  const db = new Database(CORPUS);
  const j = (o) => JSON.stringify(o);
  db.exec(`
    CREATE TABLE bills (session_year INTEGER, print_no TEXT, raw_json TEXT, published_date TEXT);
    CREATE TABLE law_trees (law_id TEXT, raw_json TEXT, tree_json TEXT);
    CREATE TABLE members (member_id INTEGER, session_year INTEGER, chamber TEXT, short_name TEXT, district INTEGER, raw_json TEXT);
    CREATE TABLE committees (session_year INTEGER, chamber TEXT, name TEXT, raw_json TEXT);
    CREATE TABLE agendas (year INTEGER, agenda_no INTEGER, raw_json TEXT);
    CREATE TABLE calendars (year INTEGER, calendar_no INTEGER, raw_json TEXT);
    CREATE TABLE floor_transcripts (year INTEGER, date_time TEXT, has_text INTEGER, raw_json TEXT);
    CREATE TABLE hearing_transcripts (year INTEGER, filename TEXT, date TEXT, has_text INTEGER, raw_json TEXT);
    CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT);
  `);
  db.prepare("INSERT INTO bills VALUES (?, ?, ?, ?)").run(2025, "S1", j({ basePrintNo: "S1" }), "2025-01-01");
  db.prepare("INSERT INTO law_trees VALUES (?, ?, ?)").run("EDN", j({ lawId: "EDN" }), j({ tree: "EDN" }));
  db.prepare("INSERT INTO members VALUES (?, ?, ?, ?, ?, ?)").run(1, 2025, "SENATE", "ALPHA", 1, j({ memberId: 1 }));
  db.prepare("INSERT INTO committees VALUES (?, ?, ?, ?)").run(2025, "SENATE", "Finance", j({ name: "Finance" }));
  db.prepare("INSERT INTO agendas VALUES (?, ?, ?)").run(2025, 1, j({ agendaNo: 1 }));
  db.prepare("INSERT INTO calendars VALUES (?, ?, ?)").run(2025, 7, j({ calendarNo: 7 }));
  db.prepare("INSERT INTO floor_transcripts VALUES (?, ?, ?, ?)").run(2025, "2025-01-01T11:00", 1, j({ dt: "a" }));
  db.prepare("INSERT INTO hearing_transcripts VALUES (?, ?, ?, ?, ?)").run(2025, "h.txt", "2025-03-01", 1, j({ f: "h" }));
  const state = db.prepare("INSERT INTO sync_state VALUES (?, ?)");
  state.run("last_synced_at", SYNCED);
  state.run("fetched_at_laws", LAWS_AT);
  state.run("fetched_at_members", MEMBERS_AT);
  state.run("fetched_at_bills", OLD_BILLS_AT);
  // No fetched_at_committees, no fetched_at_transcripts: a copy downloaded by an older version.
  db.close();
} else {
  writeFileSync(CORPUS, "");
}

process.env.NYS_CORPUS_DB = CORPUS; // db.ts binds its path at module load
const { callTool } = await import("../dist/handlers.js");
const { corpusDate } = await import("../dist/corpusDates.js");

beforeEach(() => {
  mock.restoreAll();
  mock.method(globalThis, "fetch", async () => { throw new Error("this test must not reach the network"); });
});
afterEach(() => mock.restoreAll());

const text = (r) => r.content[0].text;
const payloadOf = (r) => JSON.parse(text(r).split("\n\n---\n")[0]);
const asOfLine = (d) => new RegExp(`^Source: .*New York State Senate.*\\. As of ${d.replace(/[+.]/g, "\\$&")} \\(the date of the copy this server answers from\\)\\.`, "m");
const UNKNOWN = /^Source: .*New York State Senate.*\. As of: unknown \(this server has no usable date for it\)\./m;

const CASES = {
  bills: ["list_bills", { session_year: 2025 }],
  agendas: ["list_agendas", { year: 2025 }],
  calendars: ["list_calendars", { year: 2025 }],
  laws: ["list_laws", {}],
  members: ["list_members", { chamber: "senate", session_year: 2025 }],
  committees: ["list_committees", { chamber: "senate", session_year: 2025 }],
  floor_transcripts: ["list_floor_transcripts", { year: 2025 }],
  hearing_transcripts: ["list_hearing_transcripts", { year: 2025 }],
};
async function call(type, key = null) {
  const [name, args] = CASES[type];
  const r = await callTool(key, name, args);
  assert.notEqual(r.isError, true, `${name}: ${text(r)}`);
  return r;
}

for (const type of ["bills", "agendas", "calendars"]) {
  test(`${type}: the nightly sync refreshes them, so the answer gives the sync time`, { skip }, async () => {
    const r = await call(type);
    assert.match(text(r), asOfLine(SYNCED));
    assert.equal(payloadOf(r).source, `local corpus (synced ${SYNCED})`);
    assert.doesNotMatch(text(r), /nightly sync does not update|not recorded/);
    assert.match(payloadOf(r).freshness, /npm run sync/);
  });
}

for (const [type, at] of [["laws", LAWS_AT], ["members", MEMBERS_AT]]) {
  test(`${type}: the sync does not refresh them, so the answer gives their download time`, { skip }, async () => {
    const r = await call(type);
    assert.match(text(r), asOfLine(at));
    assert.ok(!text(r).includes(SYNCED), "the sync time must not appear");
    assert.match(text(r), new RegExp(`^The nightly sync does not update ${type}: this copy of them was downloaded ${at.replace(/[+.]/g, "\\$&")}\\.$`, "m"));
    assert.equal(payloadOf(r).source, `local corpus (${type} downloaded ${at}; the nightly sync does not update ${type})`);
    assert.match(payloadOf(r).freshness, new RegExp(`npm run fetch-data -- --types=${type}`), "names what refreshes them");
  });
}

for (const type of ["committees", "floor_transcripts", "hearing_transcripts"]) {
  const word = type.endsWith("transcripts") ? "transcripts" : type;
  test(`${type}: no recorded download time, so the answer says so, not the sync time`, { skip }, async () => {
    const r = await call(type);
    assert.match(text(r), UNKNOWN);
    assert.ok(!text(r).includes(SYNCED), "the sync time must not appear");
    assert.match(text(r), new RegExp(`^The local copy does not record when its ${word} were downloaded\\. They come from the last full download`, "m"));
    assert.match(payloadOf(r).source, new RegExp(`^local corpus \\(date of these ${word} not recorded; they come from the last full download, not the nightly sync\\)$`));
  });
}

test("keyless and not in the copy: the message gives that type's date and what refreshes it", { skip }, async () => {
  const r = await callTool(null, "get_committee", { committee_name: "Nope", chamber: "senate", session_year: 2025 });
  assert.match(text(r), /not_found_in_local_corpus/);
  assert.ok(!text(r).includes(SYNCED), "the sync time must not appear");
  assert.match(text(r), /date of these committees not recorded/);
  assert.match(text(r), /npm run fetch-data -- --types=committees/);
});

test("corpusDate: per type, from sync_state alone, with no guessing", () => {
  const state = { last_synced_at: SYNCED, fetched_at_laws: LAWS_AT };
  assert.equal(corpusDate("bills", state).asOf, SYNCED);
  assert.equal(corpusDate("calendars", state).note, null);
  assert.equal(corpusDate("laws", state).asOf, LAWS_AT);
  for (const t of ["members", "committees", "transcripts"]) {
    assert.equal(corpusDate(t, state).asOf, null, `${t} has no date of its own`);
    assert.match(corpusDate(t, state).note, /last full download/);
  }
  assert.equal(corpusDate("laws", null).asOf, null, "an unreadable sync_state gives no date");
  assert.equal(corpusDate("bills", null).words, "synced unknown date");
  // A value written before 2.7.0 (unmarked UTC) is shown with its Z, like the sync time.
  assert.equal(corpusDate("members", { fetched_at_members: "2026-06-01T14:00:00" }).asOf, "2026-06-01T14:00:00Z");
});

test("fetch-data.js records when it downloaded each type it fetched, and only those", { skip }, () => {
  const db = join(tmp, "fetched.db");
  // Every request is answered here with an empty page; nothing reaches the network.
  const preload = join(tmp, "no-network.mjs");
  writeFileSync(preload, `
    globalThis.fetch = async (url) => {
      const u = new URL(String(url));
      if (!/^\\/api\\/3\\/members\\//.test(u.pathname)) throw new Error("unexpected request " + u.pathname);
      return { ok: true, status: 200, statusText: "OK", json: async () => ({ success: true, message: "", total: 0, result: { items: [] } }) };
    };
  `);
  const year = new Date().getFullYear();
  const before = Date.now();
  const run = spawnSync(process.execPath, [
    "--import", pathToFileURL(preload).href, join(ROOT, "scripts", "fetch-data.js"),
    "--types=members", `--start-year=${year % 2 ? year : year - 1}`, "--delay-ms=0",
  ], { env: { ...process.env, NYS_LEGISLATION_API_KEY: "not-a-real-key-offline", NYS_CORPUS_DB: db }, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const rows = Object.fromEntries(new Database(db, { readonly: true }).prepare("SELECT key, value FROM sync_state").all().map((r) => [r.key, r.value]));
  assert.match(rows.fetched_at_members ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-0[45]:00$/, "New York time with its offset");
  const at = Date.parse(rows.fetched_at_members);
  assert.ok(at >= before - 1000 && at <= Date.now() + 1000, `fetched_at_members ${rows.fetched_at_members}`);
  for (const t of ["bills", "laws", "committees", "agendas", "calendars", "transcripts"]) {
    assert.equal(rows[`fetched_at_${t}`], undefined, `${t} was not downloaded, so it gets no date`);
  }
  assert.ok(rows.last_synced_at, "the sync watermark is still written");
});
