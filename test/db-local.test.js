// Pins the behavior of every local* query in src/db.ts (issue #19).
//
// Written against the pre-refactor db.ts and run green there first, so the
// one()/many() rewrite has to reproduce it exactly. Hermetic: a fixture corpus
// in a temp dir, no network, no key.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let Database = null;
try {
  ({ default: Database } = await import("better-sqlite3"));
} catch {
  Database = null;
}
const skip = Database ? false : "better-sqlite3 unavailable — cannot build a fixture corpus";

const CORPUS = join(mkdtempSync(join(tmpdir(), "nys-db-local-")), "corpus.db");
const j = (o) => JSON.stringify(o);

if (Database) {
  const db = new Database(CORPUS);
  db.exec(`
    CREATE TABLE bills (session_year INTEGER, print_no TEXT, raw_json TEXT, published_date TEXT);
    CREATE VIRTUAL TABLE bills_fts USING fts5(title);
    CREATE TABLE law_trees (law_id TEXT, raw_json TEXT, tree_json TEXT);
    CREATE TABLE law_sections (law_id TEXT, location_id TEXT, title TEXT, doc_type TEXT, has_text INTEGER, raw_json TEXT);
    CREATE TABLE members (member_id INTEGER, session_year INTEGER, chamber TEXT, short_name TEXT, district INTEGER, raw_json TEXT);
    CREATE TABLE committees (session_year INTEGER, chamber TEXT, name TEXT, raw_json TEXT);
    CREATE TABLE agendas (year INTEGER, agenda_no INTEGER, raw_json TEXT);
    CREATE TABLE calendars (year INTEGER, calendar_no INTEGER, raw_json TEXT);
    CREATE TABLE floor_transcripts (year INTEGER, date_time TEXT, has_text INTEGER, raw_json TEXT);
    CREATE TABLE hearing_transcripts (year INTEGER, filename TEXT, date TEXT, has_text INTEGER, raw_json TEXT);
    CREATE TABLE sync_state (key TEXT, value TEXT);
  `);
  const bill = db.prepare("INSERT INTO bills (rowid, session_year, print_no, raw_json, published_date) VALUES (?, ?, ?, ?, ?)");
  const fts = db.prepare("INSERT INTO bills_fts (rowid, title) VALUES (?, ?)");
  [[1, 2025, "S1", "climate bill", "2025-01-01"], [2, 2025, "S2", "climate tax", "2025-02-01"], [3, 2023, "S3", "climate old", "2023-01-01"]]
    .forEach(([id, yr, pn, title, pub]) => { bill.run(id, yr, pn, j({ printNo: pn, session: yr }), pub); fts.run(id, title); });
  db.prepare("INSERT INTO law_trees VALUES (?, ?, ?)").run("EDN", j({ lawId: "EDN" }), j({ tree: "EDN" }));
  db.prepare("INSERT INTO law_trees VALUES (?, ?, ?)").run("ABC", j({ lawId: "ABC" }), null);
  db.prepare("INSERT INTO law_sections VALUES (?, ?, ?, ?, ?, ?)").run("EDN", "6233", "t", "SECTION", 1, j({ lawId: "EDN", locationId: "6233", docType: "SECTION" }));
  db.prepare("INSERT INTO law_sections VALUES (?, ?, ?, ?, ?, ?)").run("EDN", "A125", "t", "ARTICLE", 0, j({ lawId: "EDN", locationId: "A125" }));
  db.prepare("INSERT INTO members VALUES (?, ?, ?, ?, ?, ?)").run(1, 2025, "SENATE", "BRAVO", 1, j({ memberId: 1 }));
  db.prepare("INSERT INTO members VALUES (?, ?, ?, ?, ?, ?)").run(2, 2025, "SENATE", "ALPHA", 2, j({ memberId: 2 }));
  db.prepare("INSERT INTO committees VALUES (?, ?, ?, ?)").run(2025, "SENATE", "Finance", j({ name: "Finance" }));
  db.prepare("INSERT INTO agendas VALUES (?, ?, ?)").run(2025, 1, j({ agendaNo: 1 }));
  db.prepare("INSERT INTO agendas VALUES (?, ?, ?)").run(2025, 2, j({ agendaNo: 2 }));
  db.prepare("INSERT INTO calendars VALUES (?, ?, ?)").run(2025, 7, j({ calendarNo: 7 }));
  db.prepare("INSERT INTO floor_transcripts VALUES (?, ?, ?, ?)").run(2025, "2025-01-01T11:00", 1, j({ dt: "a" }));
  db.prepare("INSERT INTO floor_transcripts VALUES (?, ?, ?, ?)").run(2025, "2025-01-02T11:00", 0, j({ dt: "b" }));
  db.prepare("INSERT INTO hearing_transcripts VALUES (?, ?, ?, ?, ?)").run(2025, "h.txt", "2025-03-01", 1, j({ f: "h" }));
  db.prepare("INSERT INTO sync_state VALUES (?, ?)").run("last_synced_at", "2026-10-22T00:00:00");
  db.close();
}

// db.ts binds its path at module load: set it before the first import.
process.env.NYS_CORPUS_DB = CORPUS;
const db = await import("../dist/db.js");

test("bills: get, list (newest first), FTS search with and without session", { skip }, async () => {
  assert.deepEqual(await db.localGetBill(2025, "s1"), { printNo: "S1", session: 2025 });
  assert.equal(await db.localGetBill(2025, "S9"), null);
  const list = await db.localListBills(2025, 10, 0);
  assert.deepEqual(list.items.map((b) => b.printNo), ["S2", "S1"]);
  assert.equal(list.size, 2);
  const all = await db.localSearchBills("climate");
  assert.equal(all.size, 3);
  assert.ok(all.items.every((i) => typeof i.rank === "number" && i.result.printNo));
  const scoped = await db.localSearchBills("climate", 2023);
  assert.deepEqual(scoped.items.map((i) => i.result.printNo), ["S3"]);
  assert.equal(await db.localSearchBills("NOT AND ("), null, "a bad FTS query returns null, not a throw");
});

test("laws: list, tree_json only, sections only with text", { skip }, async () => {
  assert.deepEqual(await db.localListLaws(), [{ lawId: "ABC" }, { lawId: "EDN" }]);
  assert.deepEqual(await db.localGetLawTree("edn"), { tree: "EDN" });
  assert.equal(await db.localGetLawTree("ABC"), null, "no tree_json falls through to live");
  assert.deepEqual(await db.localGetLawSection("edn", "6233"), { lawId: "EDN", locationId: "6233", docType: "SECTION" });
  assert.equal(await db.localGetLawSection("EDN", "A125"), null, "has_text=0 falls through to live");
});

test("members and committees", { skip }, async () => {
  const members = await db.localListMembers(2025, "senate");
  assert.deepEqual(members.items, [{ memberId: 2 }, { memberId: 1 }]);
  assert.deepEqual(await db.localGetMember(2025, "senate", 1), { memberId: 1 });
  assert.equal(await db.localGetMember(2025, "assembly", 1), null);
  assert.deepEqual((await db.localListCommittees(2025, "senate")).items, [{ name: "Finance" }]);
  assert.deepEqual(await db.localGetCommittee(2025, "senate", "Finance"), { name: "Finance" });
});

test("agendas, calendars, transcripts", { skip }, async () => {
  assert.deepEqual((await db.localListAgendas(2025)).items, [{ agendaNo: 2 }, { agendaNo: 1 }]);
  assert.deepEqual(await db.localGetAgenda(2025, 1), { agendaNo: 1 });
  assert.deepEqual((await db.localListCalendars(2025)).items, [{ calendarNo: 7 }]);
  assert.deepEqual(await db.localGetCalendar(2025, 7), { calendarNo: 7 });
  assert.deepEqual((await db.localListFloorTranscripts(2025)).items, [{ dt: "b" }, { dt: "a" }]);
  assert.deepEqual(await db.localGetFloorTranscript("2025-01-01T11:00"), { dt: "a" });
  assert.equal(await db.localGetFloorTranscript("2025-01-02T11:00"), null, "has_text=0 falls through");
  assert.deepEqual((await db.localListHearingTranscripts(2025)).items, [{ f: "h" }]);
  assert.deepEqual(await db.localGetHearingTranscript("h.txt"), { f: "h" });
});

test("sync state, and kept exports still exist (#19 warning table)", { skip }, async () => {
  assert.deepEqual(await db.getSyncState(), { last_synced_at: "2026-10-22T00:00:00" });
  assert.equal(db.getDbPath(), CORPUS);
  assert.equal(db.hasLocalCorpus(), true);
});
