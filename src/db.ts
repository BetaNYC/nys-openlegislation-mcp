/**
 * Local SQLite corpus query layer for nys-openlegislation-mcp.
 *
 * If data/corpus.db does not exist, or if better-sqlite3 is unavailable,
 * all functions return null — the MCP server falls back to the live API.
 */

import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "data", "corpus.db");

// ─── DB handle (lazy singleton) ───────────────────────────────────────────────

type BetterSqlite3 = typeof import("better-sqlite3");
let DatabaseCtor: BetterSqlite3 | null = null;
let _db: ReturnType<BetterSqlite3> | null = null;

async function getDb(): Promise<ReturnType<BetterSqlite3> | null> {
  if (_db) return _db;
  if (!existsSync(DB_PATH)) return null;
  if (!DatabaseCtor) {
    try {
      const mod = await import("better-sqlite3");
      DatabaseCtor = mod.default as unknown as BetterSqlite3;
    } catch {
      return null; // better-sqlite3 not installed — pure API mode
    }
  }
  try {
    _db = new (DatabaseCtor as any)(DB_PATH, { readonly: true }) as ReturnType<BetterSqlite3>;
    return _db;
  } catch {
    return null;
  }
}

// ─── Query helpers ────────────────────────────────────────────────────────────

type Row = Record<string, any>;

/** Run a query and return all raw rows, or null on any failure. */
async function rows(sql: string, ...params: unknown[]): Promise<Row[] | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    return (db as any).prepare(sql).all(...params) as Row[];
  } catch {
    return null;
  }
}

/** Fetch a single row's raw_json, parsed. Null if missing or on any failure. */
async function one(sql: string, ...params: unknown[]): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const row = (db as any).prepare(sql).get(...params) as { raw_json: string } | undefined;
    return row ? JSON.parse(row.raw_json) : null;
  } catch {
    return null;
  }
}

/** Fetch many rows' raw_json as a paginated-style envelope. Null on any failure. */
async function many(
  sql: string,
  ...params: unknown[]
): Promise<{ items: Record<string, unknown>[]; size: number } | null> {
  const result = await rows(sql, ...params);
  if (!result) return null;
  try {
    const items = result.map((r) => JSON.parse(r.raw_json));
    return { items, size: items.length };
  } catch {
    return null;
  }
}

// ─── Bills ────────────────────────────────────────────────────────────────────

export function localGetBill(sessionYear: number, printNo: string) {
  return one("SELECT raw_json FROM bills WHERE session_year=? AND print_no=? LIMIT 1", sessionYear, printNo.toUpperCase());
}

export async function localSearchBills(term: string, sessionYear?: number, limit = 25, offset = 0) {
  const result = await rows(
    `SELECT b.raw_json, bfts.rank
     FROM bills_fts bfts
     JOIN bills b ON b.rowid = bfts.rowid
     WHERE bills_fts MATCH ?${sessionYear ? " AND b.session_year = ?" : ""}
     ORDER BY bfts.rank
     LIMIT ? OFFSET ?`,
    term,
    ...(sessionYear ? [sessionYear] : []),
    limit,
    offset
  );
  if (!result) return null;
  try {
    const items = result.map((r) => ({ result: JSON.parse(r.raw_json), rank: r.rank as number }));
    return { items, size: items.length };
  } catch {
    return null;
  }
}

export function localListBills(sessionYear: number, limit = 25, offset = 0) {
  return many("SELECT raw_json FROM bills WHERE session_year=? ORDER BY published_date DESC LIMIT ? OFFSET ?", sessionYear, limit, offset);
}

// ─── Laws ─────────────────────────────────────────────────────────────────────

export async function localListLaws(): Promise<Record<string, unknown>[] | null> {
  return (await many("SELECT raw_json FROM law_trees ORDER BY law_id"))?.items ?? null;
}

export function localGetLawTree(lawId: string) {
  return one("SELECT raw_json FROM law_trees WHERE law_id=? LIMIT 1", lawId.toUpperCase());
}

export function localGetLawSection(lawId: string, locationId: string) {
  // has_text gate: if section text was not fetched (--include-law-text not used),
  // return null so the server falls back to the live API for the text.
  return one("SELECT raw_json FROM law_sections WHERE law_id=? AND location_id=? AND has_text!=0 LIMIT 1", lawId.toUpperCase(), locationId);
}

// ─── Members ──────────────────────────────────────────────────────────────────

export function localListMembers(sessionYear: number, chamber: string, limit = 100, offset = 0) {
  return many("SELECT raw_json FROM members WHERE session_year=? AND chamber=? ORDER BY short_name LIMIT ? OFFSET ?", sessionYear, chamber.toUpperCase(), limit, offset);
}

export function localGetMember(sessionYear: number, chamber: string, memberId: number) {
  return one("SELECT raw_json FROM members WHERE session_year=? AND chamber=? AND member_id=? LIMIT 1", sessionYear, chamber.toUpperCase(), memberId);
}

// ─── Committees ───────────────────────────────────────────────────────────────

export function localListCommittees(sessionYear: number, chamber: string, limit = 100, offset = 0) {
  return many("SELECT raw_json FROM committees WHERE session_year=? AND chamber=? ORDER BY name LIMIT ? OFFSET ?", sessionYear, chamber.toUpperCase(), limit, offset);
}

export function localGetCommittee(sessionYear: number, chamber: string, name: string) {
  return one("SELECT raw_json FROM committees WHERE session_year=? AND chamber=? AND name=? LIMIT 1", sessionYear, chamber.toUpperCase(), name);
}

// ─── Agendas ──────────────────────────────────────────────────────────────────

export function localListAgendas(year: number, limit = 50, offset = 0) {
  return many("SELECT raw_json FROM agendas WHERE year=? ORDER BY agenda_no DESC LIMIT ? OFFSET ?", year, limit, offset);
}

export function localGetAgenda(year: number, agendaNo: number) {
  return one("SELECT raw_json FROM agendas WHERE year=? AND agenda_no=? LIMIT 1", year, agendaNo);
}

// ─── Calendars ────────────────────────────────────────────────────────────────

export function localListCalendars(year: number, limit = 50, offset = 0) {
  return many("SELECT raw_json FROM calendars WHERE year=? ORDER BY calendar_no DESC LIMIT ? OFFSET ?", year, limit, offset);
}

export function localGetCalendar(year: number, calendarNo: number) {
  return one("SELECT raw_json FROM calendars WHERE year=? AND calendar_no=? LIMIT 1", year, calendarNo);
}

// ─── Transcripts ──────────────────────────────────────────────────────────────
// The has_text gate on the single-item getters: transcripts synced without
// --include-transcript-text have no body, so fall back to the live API.

export function localListFloorTranscripts(year: number, limit = 50, offset = 0) {
  return many("SELECT raw_json FROM floor_transcripts WHERE year=? ORDER BY date_time DESC LIMIT ? OFFSET ?", year, limit, offset);
}

export function localGetFloorTranscript(dateTime: string) {
  return one("SELECT raw_json FROM floor_transcripts WHERE date_time=? AND has_text!=0 LIMIT 1", dateTime);
}

export function localListHearingTranscripts(year: number, limit = 50, offset = 0) {
  return many("SELECT raw_json FROM hearing_transcripts WHERE year=? ORDER BY date DESC LIMIT ? OFFSET ?", year, limit, offset);
}

export function localGetHearingTranscript(filename: string) {
  return one("SELECT raw_json FROM hearing_transcripts WHERE filename=? AND has_text!=0 LIMIT 1", filename);
}
