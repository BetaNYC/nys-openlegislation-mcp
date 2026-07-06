#!/usr/bin/env node
/**
 * scripts/sync.js
 *
 * Incremental sync for the nys-openlegislation-mcp local corpus.
 * Fetches only records that changed since the last sync.
 * Run nightly via cron.
 *
 * Usage:
 *   NYS_LEGISLATION_API_KEY=your-key node scripts/sync.js [options]
 *
 * Options:
 *   --from=YYYY-MM-DDTHH:MM:SS   Override the start datetime (default: last_synced_at from DB)
 *   --delay-ms=N                  Delay between API calls in ms (default: 150)
 *   --dry-run                     Print what would be synced without writing to DB
 */

import { existsSync } from "fs";
import { START_OFFSET, nextOffset, isLastPage, basePrintNo } from "./lib/api-helpers.js";

let Database;
try {
  ({ default: Database } = await import("better-sqlite3"));
} catch {
  console.error(
    "Error: better-sqlite3 is not installed or failed to build on this machine.\n" +
      "The corpus scripts require it: npm install better-sqlite3"
  );
  process.exit(1);
}
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const DB_PATH = process.env.NYS_CORPUS_DB ?? join(DATA_DIR, "corpus.db");
const BASE_URL = "https://legislation.nysenate.gov/api/3";

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (prefix) => args.find((a) => a.startsWith(prefix))?.split("=")[1];
const DELAY_MS = parseInt(getArg("--delay-ms=") ?? "150");
const DRY_RUN = args.includes("--dry-run");
const FROM_OVERRIDE = getArg("--from=");

const API_KEY = process.env.NYS_LEGISLATION_API_KEY;
if (!API_KEY) {
  console.error("Error: NYS_LEGISLATION_API_KEY environment variable is not set.");
  process.exit(1);
}

if (!existsSync(DB_PATH)) {
  console.error(`Error: Corpus database not found at ${DB_PATH}`);
  console.error("Run fetch-data.js first to build the initial corpus.");
  process.exit(1);
}

// ─── DB setup ─────────────────────────────────────────────────────────────────

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

// Read sync config
const syncState = Object.fromEntries(
  db.prepare("SELECT key, value FROM sync_state").all().map((r) => [r.key, r.value])
);

const INCLUDE_LAW_TEXT = syncState.include_law_text === "1";
const INCLUDE_TRANSCRIPT_TEXT = syncState.include_transcript_text === "1";

// Normalize legacy space-separated timestamps (stored before ISO fix) to ISO 8601 with T.
const lastSyncedAt = (FROM_OVERRIDE ?? syncState.last_synced_at)?.replace(" ", "T");
if (!lastSyncedAt) {
  console.error("Error: No last_synced_at found in sync_state. Run fetch-data.js first.");
  process.exit(1);
}

const toDateTime = new Date().toISOString().split(".")[0]; // ISO 8601 with T — required by the API
const fromDateTime = lastSyncedAt;

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
  // Top-level `total` is the full match count; result.size is just the page size.
  return { result: data.result, total: data.total ?? null };
}

// ─── Upsert statements ────────────────────────────────────────────────────────

// Ensure schema additions exist on older corpora (cheap, idempotent).
const billCols = db.prepare("PRAGMA table_info(bills)").all().map((c) => c.name);
if (!billCols.includes("active_version")) {
  db.exec("ALTER TABLE bills ADD COLUMN active_version TEXT");
}

const upsertBill = db.prepare(`
  INSERT INTO bills (session_year, print_no, base_print_no, title, summary, sponsor_name, status_desc, committee, published_date, last_updated, active_version, raw_json)
  VALUES (@session_year, @print_no, @base_print_no, @title, @summary, @sponsor_name, @status_desc, @committee, @published_date, @last_updated, @active_version, @raw_json)
  ON CONFLICT(session_year, print_no) DO UPDATE SET
    title=excluded.title, summary=excluded.summary, sponsor_name=excluded.sponsor_name,
    status_desc=excluded.status_desc, committee=excluded.committee,
    last_updated=excluded.last_updated, active_version=excluded.active_version,
    raw_json=excluded.raw_json
`);

const upsertMember = db.prepare(`
  INSERT INTO members (member_id, session_year, chamber, short_name, district, raw_json)
  VALUES (@member_id, @session_year, @chamber, @short_name, @district, @raw_json)
  ON CONFLICT(member_id, session_year, chamber) DO UPDATE SET
    short_name=excluded.short_name, raw_json=excluded.raw_json
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

const setSyncState = db.prepare(`
  INSERT INTO sync_state (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value
`);

// ─── Sync logic ───────────────────────────────────────────────────────────────

async function syncUpdates() {
  console.log(`\nFetching updates from ${fromDateTime} to ${toDateTime}…`);
  let offset = START_OFFSET; // API offsets are 1-based (offsetStart)
  const limit = 1000;
  let totalProcessed = 0;
  let totalFailed = 0;
  let fetchedCount = 0;

  while (true) {
    const { result, total } = await apiFetch(
      `/updates/${encodeURIComponent(fromDateTime)}/${encodeURIComponent(toDateTime)}`,
      { limit, offset, order: "asc" }
    );
    const items = result.items ?? [];
    if (items.length === 0) break;
    fetchedCount += items.length;

    console.log(`  Processing ${items.length} updates (offset ${offset})…`);

    for (const update of items) {
      const type = update.contentType?.toLowerCase();
      const id = update.id ?? {};

      try {
        if (type === "bill" && id.basePrintNo && id.session) {
          const { result: bill } = await apiFetch(`/bills/${id.session}/${id.basePrintNo}`);
          if (!DRY_RUN) {
            // Key on the BASE print number. Amended bills report printNo with
            // the active amendment letter (e.g. S1234A) while the corpus row
            // is keyed S1234 — using printNo here froze base rows forever.
            upsertBill.run({
              session_year: bill.session,
              print_no: basePrintNo(bill.basePrintNo ?? bill.printNo),
              active_version: bill.activeVersion ?? null,
              base_print_no: bill.basePrintNo,
              title: bill.title ?? null,
              summary: bill.summary ?? null,
              sponsor_name: bill.sponsor?.member?.fullName ?? null,
              status_desc: bill.status?.statusDesc ?? null,
              committee: bill.status?.committeeName ?? null,
              published_date: bill.publishedDateTime ?? null,
              last_updated: new Date().toISOString(),
              raw_json: JSON.stringify(bill),
            });
          }
          totalProcessed++;
          await sleep(DELAY_MS);

        } else if (type === "agenda" && id.number && id.year) {
          const { result: agenda } = await apiFetch(`/agendas/${id.year}/${id.number}`);
          if (!DRY_RUN) {
            upsertAgenda.run({
              year: id.year,
              agenda_no: id.number,
              week_of: agenda.weekOf ?? null,
              raw_json: JSON.stringify(agenda),
            });
          }
          totalProcessed++;
          await sleep(DELAY_MS);

        } else if (type === "calendar" && id.calNo && id.year) {
          const { result: cal } = await apiFetch(`/calendars/${id.year}/${id.calNo}`);
          if (!DRY_RUN) {
            upsertCalendar.run({
              year: id.year,
              calendar_no: id.calNo,
              cal_date: cal.calDate ?? null,
              raw_json: JSON.stringify(cal),
            });
          }
          totalProcessed++;
          await sleep(DELAY_MS);

        }
        // The aggregate updates feed only carries AGENDA / BILL / CALENDAR / LAW
        // content types — committees never appear here, so there is no committee
        // branch. Committee data goes stale between full fetch-data.js runs; see
        // the "Known limitations" note in the README.
        // Law and transcript updates: too expensive to sync section-by-section.
        // Users should re-run fetch-data.js for those periodically.
      } catch (e) {
        totalFailed++;
        console.warn(`  ⚠ Skipped ${type} ${JSON.stringify(id)}: ${e.message}`);
      }
    }

    if (isLastPage(items.length, limit, fetchedCount, total)) break;
    offset = nextOffset(offset, items.length);
    await sleep(DELAY_MS);
  }

  return { totalProcessed, totalFailed };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log("NYS Open Legislation — incremental sync");
if (DRY_RUN) console.log("  [DRY RUN — no writes]");
console.log(`  From: ${fromDateTime}`);
console.log(`  To:   ${toDateTime}`);
console.log(`  DB:   ${DB_PATH}`);

const startTime = Date.now();
const { totalProcessed: count, totalFailed: failed } = await syncUpdates();

if (!DRY_RUN) {
  if (failed === 0) {
    setSyncState.run("last_synced_at", toDateTime);
  } else {
    // Leave the watermark where it was so the next run retries the window
    // that contained the failed items.
    console.warn(
      `\n⚠ ${failed} item(s) failed — last_synced_at NOT advanced; next run will retry from ${fromDateTime}`
    );
  }
}

db.close();

const elapsed = Math.round((Date.now() - startTime) / 1000);
console.log(`\n✅ Synced ${count} records in ${elapsed}s${failed ? ` (${failed} failed)` : ""}`);
if (DRY_RUN) console.log("   (dry run — DB not updated)");
