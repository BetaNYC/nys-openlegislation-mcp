#!/usr/bin/env node
/**
 * scripts/fetch-data.js
 *
 * Initial bulk fetch for the nys-openlegislation-mcp local corpus.
 * Run once (or to rebuild from scratch).
 *
 * Usage:
 *   NYS_LEGISLATION_API_KEY=your-key node scripts/fetch-data.js [options]
 *
 * Options:
 *   --start-year=YYYY          First session year to fetch (default: 2009)
 *   --include-law-text         Fetch and store full law section text (~+1.2 GB)
 *   --include-transcript-text  Fetch and store full transcript text (~+600 MB)
 *   --delay-ms=N               Delay between API pages in ms (default: 150)
 *   --types=bills,laws,...     Comma-separated list of types to fetch
 *                              (default: bills,laws,members,committees,agendas,calendars,transcripts)
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const DB_PATH = join(DATA_DIR, "corpus.db");
const BASE_URL = "https://legislation.nysenate.gov/api/3";

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (prefix) => args.find((a) => a.startsWith(prefix))?.split("=")[1];

const START_YEAR = parseInt(getArg("--start-year=") ?? "2009");
const INCLUDE_LAW_TEXT = args.includes("--include-law-text");
const INCLUDE_TRANSCRIPT_TEXT = args.includes("--include-transcript-text");
const DELAY_MS = parseInt(getArg("--delay-ms=") ?? "150");
const ALL_TYPES = ["bills", "laws", "members", "committees", "agendas", "calendars", "transcripts"];
const TYPES = new Set(getArg("--types=")?.split(",") ?? ALL_TYPES);

const API_KEY = process.env.NYS_LEGISLATION_API_KEY;
if (!API_KEY) {
  console.error("Error: NYS_LEGISLATION_API_KEY environment variable is not set.");
  process.exit(1);
}

// ─── DB setup ─────────────────────────────────────────────────────────────────

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("cache_size = -64000"); // 64 MB cache

db.exec(`
  CREATE TABLE IF NOT EXISTS bills (
    session_year   INTEGER NOT NULL,
    print_no       TEXT NOT NULL,
    base_print_no  TEXT NOT NULL,
    title          TEXT,
    summary        TEXT,
    sponsor_name   TEXT,
    status_desc    TEXT,
    committee      TEXT,
    published_date TEXT,
    last_updated   TEXT,
    raw_json       TEXT,
    PRIMARY KEY (session_year, print_no)
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS bills_fts USING fts5(
    title, summary, sponsor_name,
    content='bills',
    content_rowid='rowid',
    tokenize='porter ascii'
  );

  CREATE TABLE IF NOT EXISTS law_trees (
    law_id    TEXT PRIMARY KEY,
    name      TEXT,
    law_type  TEXT,
    raw_json  TEXT
  );

  CREATE TABLE IF NOT EXISTS law_sections (
    law_id      TEXT NOT NULL,
    location_id TEXT NOT NULL,
    title       TEXT,
    doc_type    TEXT,
    has_text    INTEGER DEFAULT 0,
    raw_json    TEXT,
    PRIMARY KEY (law_id, location_id)
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS law_sections_fts USING fts5(
    title, text,
    content='law_sections',
    content_rowid='rowid',
    tokenize='porter ascii'
  );

  CREATE TABLE IF NOT EXISTS members (
    member_id    INTEGER NOT NULL,
    session_year INTEGER NOT NULL,
    chamber      TEXT NOT NULL,
    short_name   TEXT,
    district     INTEGER,
    raw_json     TEXT,
    PRIMARY KEY (member_id, session_year, chamber)
  );

  CREATE TABLE IF NOT EXISTS committees (
    session_year INTEGER NOT NULL,
    chamber      TEXT NOT NULL,
    name         TEXT NOT NULL,
    raw_json     TEXT,
    PRIMARY KEY (session_year, chamber, name)
  );

  CREATE TABLE IF NOT EXISTS agendas (
    year       INTEGER NOT NULL,
    agenda_no  INTEGER NOT NULL,
    week_of    TEXT,
    raw_json   TEXT,
    PRIMARY KEY (year, agenda_no)
  );

  CREATE TABLE IF NOT EXISTS calendars (
    year        INTEGER NOT NULL,
    calendar_no INTEGER NOT NULL,
    cal_date    TEXT,
    raw_json    TEXT,
    PRIMARY KEY (year, calendar_no)
  );

  CREATE TABLE IF NOT EXISTS floor_transcripts (
    date_time  TEXT PRIMARY KEY,
    year       INTEGER,
    has_text   INTEGER DEFAULT 0,
    raw_json   TEXT
  );

  CREATE TABLE IF NOT EXISTS hearing_transcripts (
    filename   TEXT PRIMARY KEY,
    year       INTEGER,
    has_text   INTEGER DEFAULT 0,
    raw_json   TEXT
  );

  CREATE TABLE IF NOT EXISTS sync_state (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiFetch(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("key", API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API ${res.status} ${res.statusText} — ${path}`);
  const data = await res.json();
  if (!data.success) throw new Error(`API failure: ${data.message} — ${path}`);
  return data.result;
}

async function fetchAllPages(path, params = {}, label = path) {
  const items = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const result = await apiFetch(path, { ...params, limit, offset });
    const page = Array.isArray(result) ? result : (result.items ?? []);
    items.push(...page);
    const size = result.size ?? page.length;
    process.stdout.write(`\r  ${label}: ${items.length} fetched…`);
    if (page.length < limit || size <= offset + limit) break;
    offset += limit;
    await sleep(DELAY_MS);
  }
  console.log(`\r  ${label}: ${items.length} fetched ✓`);
  return items;
}

function sessionYears() {
  const years = [];
  const current = new Date().getFullYear();
  const currentOdd = current % 2 === 0 ? current - 1 : current;
  for (let y = START_YEAR; y <= currentOdd; y += 2) years.push(y);
  return years;
}

function calendarYears() {
  const years = [];
  for (let y = START_YEAR; y <= new Date().getFullYear(); y++) years.push(y);
  return years;
}

// ─── FTS triggers (keep index in sync on upsert) ─────────────────────────────

db.exec(`
  CREATE TRIGGER IF NOT EXISTS bills_fts_insert AFTER INSERT ON bills BEGIN
    INSERT INTO bills_fts(rowid, title, summary, sponsor_name)
    VALUES (new.rowid, new.title, new.summary, new.sponsor_name);
  END;
  CREATE TRIGGER IF NOT EXISTS bills_fts_delete AFTER DELETE ON bills BEGIN
    INSERT INTO bills_fts(bills_fts, rowid, title, summary, sponsor_name)
    VALUES ('delete', old.rowid, old.title, old.summary, old.sponsor_name);
  END;
  CREATE TRIGGER IF NOT EXISTS bills_fts_update AFTER UPDATE ON bills BEGIN
    INSERT INTO bills_fts(bills_fts, rowid, title, summary, sponsor_name)
    VALUES ('delete', old.rowid, old.title, old.summary, old.sponsor_name);
    INSERT INTO bills_fts(rowid, title, summary, sponsor_name)
    VALUES (new.rowid, new.title, new.summary, new.sponsor_name);
  END;
`);

// ─── Upsert helpers ───────────────────────────────────────────────────────────

const upsertBill = db.prepare(`
  INSERT INTO bills (session_year, print_no, base_print_no, title, summary, sponsor_name, status_desc, committee, published_date, last_updated, raw_json)
  VALUES (@session_year, @print_no, @base_print_no, @title, @summary, @sponsor_name, @status_desc, @committee, @published_date, @last_updated, @raw_json)
  ON CONFLICT(session_year, print_no) DO UPDATE SET
    title=excluded.title, summary=excluded.summary, sponsor_name=excluded.sponsor_name,
    status_desc=excluded.status_desc, committee=excluded.committee,
    last_updated=excluded.last_updated, raw_json=excluded.raw_json
`);

const upsertLawTree = db.prepare(`
  INSERT INTO law_trees (law_id, name, law_type, raw_json)
  VALUES (@law_id, @name, @law_type, @raw_json)
  ON CONFLICT(law_id) DO UPDATE SET name=excluded.name, raw_json=excluded.raw_json
`);

const upsertLawSection = db.prepare(`
  INSERT INTO law_sections (law_id, location_id, title, doc_type, has_text, raw_json)
  VALUES (@law_id, @location_id, @title, @doc_type, @has_text, @raw_json)
  ON CONFLICT(law_id, location_id) DO UPDATE SET
    title=excluded.title, has_text=excluded.has_text, raw_json=excluded.raw_json
`);

const upsertMember = db.prepare(`
  INSERT INTO members (member_id, session_year, chamber, short_name, district, raw_json)
  VALUES (@member_id, @session_year, @chamber, @short_name, @district, @raw_json)
  ON CONFLICT(member_id, session_year, chamber) DO UPDATE SET
    short_name=excluded.short_name, raw_json=excluded.raw_json
`);

const upsertCommittee = db.prepare(`
  INSERT INTO committees (session_year, chamber, name, raw_json)
  VALUES (@session_year, @chamber, @name, @raw_json)
  ON CONFLICT(session_year, chamber, name) DO UPDATE SET raw_json=excluded.raw_json
`);

const upsertAgenda = db.prepare(`
  INSERT INTO agendas (year, agenda_no, week_of, raw_json)
  VALUES (@year, @agenda_no, @week_of, @raw_json)
  ON CONFLICT(year, agenda_no) DO UPDATE SET week_of=excluded.week_of, raw_json=excluded.raw_json
`);

const upsertCalendar = db.prepare(`
  INSERT INTO calendars (year, calendar_no, cal_date, raw_json)
  VALUES (@year, @calendar_no, @cal_date, @raw_json)
  ON CONFLICT(year, calendar_no) DO UPDATE SET cal_date=excluded.cal_date, raw_json=excluded.raw_json
`);

const upsertFloorTranscript = db.prepare(`
  INSERT INTO floor_transcripts (date_time, year, has_text, raw_json)
  VALUES (@date_time, @year, @has_text, @raw_json)
  ON CONFLICT(date_time) DO UPDATE SET has_text=excluded.has_text, raw_json=excluded.raw_json
`);

const upsertHearingTranscript = db.prepare(`
  INSERT INTO hearing_transcripts (filename, year, has_text, raw_json)
  VALUES (@filename, @year, @has_text, @raw_json)
  ON CONFLICT(filename) DO UPDATE SET has_text=excluded.has_text, raw_json=excluded.raw_json
`);

const setSyncState = db.prepare(`
  INSERT INTO sync_state (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value
`);

// ─── Fetchers ─────────────────────────────────────────────────────────────────

async function fetchBills() {
  console.log("\n📋 Fetching bills…");
  const insertMany = db.transaction((bills) => {
    for (const b of bills) {
      upsertBill.run({
        session_year: b.session,
        print_no: b.printNo,
        base_print_no: b.basePrintNo,
        title: b.title ?? null,
        summary: b.summary ?? null,
        sponsor_name: b.sponsor?.member?.fullName ?? null,
        status_desc: b.status?.statusDesc ?? null,
        committee: b.status?.committeeName ?? null,
        published_date: b.publishedDateTime ?? null,
        last_updated: b.amendedDate ?? null,
        raw_json: JSON.stringify(b),
      });
    }
  });

  for (const year of sessionYears()) {
    const bills = await fetchAllPages(`/bills/${year}`, {}, `bills/${year}`);
    insertMany(bills);
    await sleep(DELAY_MS);
  }
}

async function fetchLaws() {
  console.log("\n📜 Fetching laws…");
  const lawList = await apiFetch("/laws", { limit: 500 });
  const laws = lawList.items ?? [];
  console.log(`  Found ${laws.length} law bodies`);

  for (const law of laws) {
    upsertLawTree.run({
      law_id: law.lawId,
      name: law.name,
      law_type: law.lawType,
      raw_json: JSON.stringify(law),
    });

    // Fetch tree structure (no full text here)
    try {
      const tree = await apiFetch(`/laws/${law.lawId}`);
      // Extract sections from the tree and store metadata
      const sections = flattenLawTree(tree.documents, law.lawId);
      const insertSections = db.transaction((secs) => {
        for (const sec of secs) {
          upsertLawSection.run({
            law_id: law.lawId,
            location_id: sec.locationId,
            title: sec.title ?? null,
            doc_type: sec.docType ?? null,
            has_text: 0,
            raw_json: JSON.stringify(sec),
          });
        }
      });
      insertSections(sections);

      if (INCLUDE_LAW_TEXT) {
        // Fetch full text for each section
        for (const sec of sections) {
          if (sec.docType !== "SECTION") continue;
          try {
            const fullSec = await apiFetch(`/laws/${law.lawId}/${sec.locationId}`);
            upsertLawSection.run({
              law_id: law.lawId,
              location_id: sec.locationId,
              title: fullSec.title ?? sec.title ?? null,
              doc_type: fullSec.docType ?? sec.docType ?? null,
              has_text: 1,
              raw_json: JSON.stringify(fullSec),
            });
            await sleep(DELAY_MS);
          } catch { /* skip individual section errors */ }
        }
      }

      process.stdout.write(`\r  ${law.lawId}: ${sections.length} sections ✓`);
    } catch (e) {
      process.stdout.write(`\r  ${law.lawId}: skipped (${e.message})`);
    }
    await sleep(DELAY_MS);
  }
  console.log();
}

function flattenLawTree(node, lawId, acc = []) {
  if (!node) return acc;
  const lv = node.lawVersion ?? node;
  if (lv.locationId) {
    acc.push({
      lawId,
      locationId: lv.locationId,
      title: lv.title,
      docType: lv.docType,
      activeDate: lv.activeDate,
    });
  }
  for (const child of node.children ?? []) {
    flattenLawTree(child, lawId, acc);
  }
  return acc;
}

async function fetchMembers() {
  console.log("\n👤 Fetching members…");
  for (const year of sessionYears()) {
    for (const chamber of ["senate", "assembly"]) {
      const items = await fetchAllPages(
        `/members/${year}/${chamber}`, {}, `members/${year}/${chamber}`
      );
      const insertMany = db.transaction((members) => {
        for (const m of members) {
          upsertMember.run({
            member_id: m.memberId,
            session_year: year,
            chamber: chamber.toUpperCase(),
            short_name: m.shortName,
            district: m.districtCode ?? null,
            raw_json: JSON.stringify(m),
          });
        }
      });
      insertMany(items);
      await sleep(DELAY_MS);
    }
  }
}

async function fetchCommittees() {
  console.log("\n🏛️  Fetching committees…");
  for (const year of sessionYears()) {
    for (const chamber of ["senate", "assembly"]) {
      const items = await fetchAllPages(
        `/committees/${year}/${chamber}`, {}, `committees/${year}/${chamber}`
      );
      const insertMany = db.transaction((committees) => {
        for (const c of committees) {
          upsertCommittee.run({
            session_year: year,
            chamber: chamber.toUpperCase(),
            name: c.name,
            raw_json: JSON.stringify(c),
          });
        }
      });
      insertMany(items);
      await sleep(DELAY_MS);
    }
  }
}

async function fetchAgendas() {
  console.log("\n📅 Fetching agendas…");
  for (const year of calendarYears()) {
    try {
      const items = await fetchAllPages(`/agendas/${year}`, {}, `agendas/${year}`);
      const insertMany = db.transaction((agendas) => {
        for (const a of agendas) {
          upsertAgenda.run({
            year,
            agenda_no: a.id?.number ?? a.agendaNo,
            week_of: a.weekOf ?? null,
            raw_json: JSON.stringify(a),
          });
        }
      });
      insertMany(items);
    } catch { /* year may have no agendas */ }
    await sleep(DELAY_MS);
  }
}

async function fetchCalendars() {
  console.log("\n📆 Fetching calendars…");
  for (const year of calendarYears()) {
    try {
      const items = await fetchAllPages(`/calendars/${year}`, {}, `calendars/${year}`);
      const insertMany = db.transaction((calendars) => {
        for (const c of calendars) {
          upsertCalendar.run({
            year,
            calendar_no: c.calendarNo,
            cal_date: c.calDate ?? null,
            raw_json: JSON.stringify(c),
          });
        }
      });
      insertMany(items);
    } catch { /* year may have no calendars */ }
    await sleep(DELAY_MS);
  }
}

async function fetchTranscripts() {
  console.log("\n🎙️  Fetching transcripts…");
  for (const year of calendarYears()) {
    // Floor transcripts
    try {
      const items = await fetchAllPages(
        `/transcripts/floor/${year}`, {}, `floor/${year}`
      );
      const insertMany = db.transaction((transcripts) => {
        for (const t of transcripts) {
          const hasText = INCLUDE_TRANSCRIPT_TEXT && !!t.text;
          upsertFloorTranscript.run({
            date_time: t.dateTime,
            year,
            has_text: hasText ? 1 : 0,
            raw_json: JSON.stringify(
              INCLUDE_TRANSCRIPT_TEXT ? t : { ...t, text: undefined }
            ),
          });
        }
      });
      insertMany(items);
    } catch { /* year may have no floor transcripts */ }

    // Hearing transcripts
    try {
      const items = await fetchAllPages(
        `/transcripts/hearing/${year}`, {}, `hearing/${year}`
      );
      const insertMany = db.transaction((transcripts) => {
        for (const t of transcripts) {
          const hasText = INCLUDE_TRANSCRIPT_TEXT && !!t.text;
          upsertHearingTranscript.run({
            filename: t.filename,
            year,
            has_text: hasText ? 1 : 0,
            raw_json: JSON.stringify(
              INCLUDE_TRANSCRIPT_TEXT ? t : { ...t, text: undefined }
            ),
          });
        }
      });
      insertMany(items);
    } catch { /* year may have no hearing transcripts */ }

    await sleep(DELAY_MS);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log("NYS Open Legislation — bulk fetch");
console.log(`  Start year:        ${START_YEAR}`);
console.log(`  Include law text:  ${INCLUDE_LAW_TEXT}`);
console.log(`  Include xscr text: ${INCLUDE_TRANSCRIPT_TEXT}`);
console.log(`  Delay between pages: ${DELAY_MS}ms`);
console.log(`  Types: ${[...TYPES].join(", ")}`);
console.log(`  DB: ${DB_PATH}`);
console.log();

const startTime = Date.now();

if (TYPES.has("bills"))       await fetchBills();
if (TYPES.has("laws"))        await fetchLaws();
if (TYPES.has("members"))     await fetchMembers();
if (TYPES.has("committees"))  await fetchCommittees();
if (TYPES.has("agendas"))     await fetchAgendas();
if (TYPES.has("calendars"))   await fetchCalendars();
if (TYPES.has("transcripts")) await fetchTranscripts();

// Persist config to sync_state
const now = new Date().toISOString().replace("T", " ").split(".")[0];
setSyncState.run("last_synced_at", now);
setSyncState.run("start_year", String(START_YEAR));
setSyncState.run("include_law_text", INCLUDE_LAW_TEXT ? "1" : "0");
setSyncState.run("include_transcript_text", INCLUDE_TRANSCRIPT_TEXT ? "1" : "0");

db.close();

const elapsed = Math.round((Date.now() - startTime) / 1000);
console.log(`\n✅ Done in ${Math.floor(elapsed / 60)}m ${elapsed % 60}s`);
console.log(`   DB: ${DB_PATH}`);
