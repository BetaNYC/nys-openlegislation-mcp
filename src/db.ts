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
// NYS_CORPUS_DB overrides the corpus location; default is data/corpus.db in the package.
const DB_PATH = process.env.NYS_CORPUS_DB ?? join(__dirname, "..", "data", "corpus.db");

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

/** Returns the configured data directory path. */
export function getDbPath(): string {
  return DB_PATH;
}

/** True if the corpus database exists locally. */
export function hasLocalCorpus(): boolean {
  return existsSync(DB_PATH);
}

// ─── Query helpers ────────────────────────────────────────────────────────────
//
// Every local* lookup is "open the db, run one statement, parse raw_json, and
// return null on any failure so the caller falls through to the live API".
// These three carry that once (issue #19).

type Row = Record<string, any>;
type Rows = { items: Record<string, unknown>[]; size: number };

/** Run `fn` against the corpus; null when there is no corpus or it throws. */
async function query<T>(fn: (db: any) => T): Promise<T | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    return fn(db);
  } catch {
    return null;
  }
}

/** First row's parsed raw_json, or null. Rows with has_text=0 count as absent. */
function one(sql: string, ...params: unknown[]): Promise<Record<string, unknown> | null> {
  return query((db) => {
    const row = db.prepare(sql).get(...params) as Row | undefined;
    if (!row || ("has_text" in row && !row.has_text)) return null;
    return JSON.parse(row.raw_json);
  });
}

/** Every row's parsed raw_json, as `{ items, size }`. */
function many(sql: string, ...params: unknown[]): Promise<Rows | null> {
  return query((db) => {
    const items = (db.prepare(sql).all(...params) as Row[]).map((r) => JSON.parse(r.raw_json));
    return { items, size: items.length };
  });
}

// ─── Sync state ───────────────────────────────────────────────────────────────

export function getSyncState(): Promise<Record<string, string> | null> {
  return query((db) => {
    const rows = db.prepare("SELECT key, value FROM sync_state").all() as Array<{ key: string; value: string }>;
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  });
}

// ─── Bills ────────────────────────────────────────────────────────────────────

export function localGetBill(sessionYear: number, printNo: string) {
  return one("SELECT raw_json FROM bills WHERE session_year=? AND print_no=? LIMIT 1", sessionYear, printNo.toUpperCase());
}

export function localSearchBills(
  term: string,
  sessionYear?: number,
  limit = 25,
  offset = 0
): Promise<Rows | null> {
  return query((db) => {
    const rows = db
      .prepare(
        `SELECT b.raw_json, bfts.rank
         FROM bills_fts bfts
         JOIN bills b ON b.rowid = bfts.rowid
         WHERE bills_fts MATCH ?${sessionYear ? " AND b.session_year = ?" : ""}
         ORDER BY bfts.rank
         LIMIT ? OFFSET ?`
      )
      .all(term, ...(sessionYear ? [sessionYear] : []), limit, offset) as Array<{ raw_json: string; rank: number }>;
    const items = rows.map((r) => ({ result: JSON.parse(r.raw_json), rank: r.rank }));
    return { items, size: items.length };
  });
}

export function localListBills(sessionYear: number, limit = 25, offset = 0) {
  return many("SELECT raw_json FROM bills WHERE session_year=? ORDER BY published_date DESC LIMIT ? OFFSET ?", sessionYear, limit, offset);
}

// ─── Laws ─────────────────────────────────────────────────────────────────────

export async function localListLaws(): Promise<Record<string, unknown>[] | null> {
  return (await many("SELECT raw_json FROM law_trees ORDER BY law_id"))?.items ?? null;
}

export function localGetLawTree(lawId: string): Promise<Record<string, unknown> | null> {
  // raw_json in law_trees holds the law *list item* (id/name/type), not the
  // document tree — returning it here used to serve a stub instead of the
  // actual table of contents. The real tree lives in tree_json (populated by
  // fetch-data.js since 2026-07). If it's absent (older corpus or column
  // missing), return null so the server falls through to the live API.
  return query((db) => {
    const row = db.prepare("SELECT tree_json FROM law_trees WHERE law_id=? LIMIT 1").get(lawId.toUpperCase()) as
      | { tree_json: string | null }
      | undefined;
    return row?.tree_json ? JSON.parse(row.tree_json) : null;
  });
}

export function localGetLawSection(lawId: string, locationId: string) {
  // has_text=0 (synced without --include-law-text) → null, so the text comes from the API.
  return one("SELECT raw_json, has_text FROM law_sections WHERE law_id=? AND location_id=? LIMIT 1", lawId.toUpperCase(), locationId);
}

// ─── Members ──────────────────────────────────────────────────────────────────

export function localListMembers(sessionYear: number, chamber: string, limit = 100, offset = 0) {
  return many("SELECT raw_json FROM members WHERE session_year=? AND chamber=? ORDER BY short_name LIMIT ? OFFSET ?", sessionYear, chamber.toUpperCase(), limit, offset);
}

export function localGetMember(sessionYear: number, chamber: string, memberId: number) {
  return one("SELECT raw_json FROM members WHERE session_year=? AND chamber=? AND member_id=? LIMIT 1", sessionYear, chamber.toUpperCase(), memberId);
}

/**
 * Name search over the local members table (issue #17).
 *
 * A case-insensitive substring match on short_name and, when the corpus has it,
 * full_name (backfilled from bill sponsor blocks by the corpus scripts). Unlike
 * the live API, `chamber` and `sessionYear` are applied here in SQL, so they
 * always filter. Every row carries `chamber` and `fullName` — the two fields a
 * caller needs to tell Kristen Gonzalez (SD 59) from Jessica Gonzalez-Rojas
 * (AD 34) without a follow-up lookup per candidate.
 *
 * This is NOT ElasticSearch: a field query such as `districtCode:20` matches
 * nothing here and, with an API key, falls through to the live search.
 */
export function localSearchMembers(
  term: string,
  sessionYear?: number,
  chamber?: string,
  limit = 25,
  offset = 0
): Promise<Rows | null> {
  return query((db) => {
    const cols = (db.prepare("PRAGMA table_info(members)").all() as Array<{ name: string }>)
      .map((c) => c.name);
    const hasFullName = cols.includes("full_name");
    // Escape LIKE wildcards so a literal % or _ in a name is matched literally.
    const pattern = `%${term.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const where = [
      hasFullName
        ? "(short_name LIKE ? ESCAPE '\\' OR full_name LIKE ? ESCAPE '\\')"
        : "short_name LIKE ? ESCAPE '\\'",
    ];
    const params: unknown[] = hasFullName ? [pattern, pattern] : [pattern];
    if (sessionYear) {
      where.push("session_year = ?");
      params.push(sessionYear);
    }
    if (chamber) {
      where.push("chamber = ?");
      params.push(chamber.toUpperCase());
    }
    const rows = db
      .prepare(
        `SELECT raw_json, chamber, ${hasFullName ? "full_name" : "NULL AS full_name"}
         FROM members WHERE ${where.join(" AND ")}
         ORDER BY session_year DESC, short_name LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as Array<{ raw_json: string; chamber: string; full_name: string | null }>;
    const items = rows.map((r) => {
      const m = JSON.parse(r.raw_json);
      return { ...m, chamber: r.chamber, fullName: r.full_name ?? m.fullName ?? null };
    });
    return { items, size: items.length };
  });
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
// Transcript rows synced without text (has_text=0) fall through to the API.

export function localListFloorTranscripts(year: number, limit = 50, offset = 0) {
  return many("SELECT raw_json FROM floor_transcripts WHERE year=? ORDER BY date_time DESC LIMIT ? OFFSET ?", year, limit, offset);
}

export function localGetFloorTranscript(dateTime: string) {
  return one("SELECT raw_json, has_text FROM floor_transcripts WHERE date_time=? LIMIT 1", dateTime);
}

export function localListHearingTranscripts(year: number, limit = 50, offset = 0) {
  return many("SELECT raw_json FROM hearing_transcripts WHERE year=? ORDER BY date DESC LIMIT ? OFFSET ?", year, limit, offset);
}

export function localGetHearingTranscript(filename: string) {
  return one("SELECT raw_json, has_text FROM hearing_transcripts WHERE filename=? LIMIT 1", filename);
}
