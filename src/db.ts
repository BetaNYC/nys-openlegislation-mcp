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

/** Returns the configured data directory path. */
export function getDbPath(): string {
  return DB_PATH;
}

/** True if the corpus database exists locally. */
export function hasLocalCorpus(): boolean {
  return existsSync(DB_PATH);
}

// ─── Sync state ───────────────────────────────────────────────────────────────

export async function getSyncState(): Promise<Record<string, string> | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const rows = (db as any).prepare("SELECT key, value FROM sync_state").all() as Array<{key: string; value: string}>;
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } catch {
    return null;
  }
}

// ─── Bills ────────────────────────────────────────────────────────────────────

export async function localGetBill(
  sessionYear: number,
  printNo: string
): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const row = (db as any)
      .prepare("SELECT raw_json FROM bills WHERE session_year=? AND print_no=? LIMIT 1")
      .get(sessionYear, printNo.toUpperCase()) as { raw_json: string } | undefined;
    return row ? JSON.parse(row.raw_json) : null;
  } catch {
    return null;
  }
}

export async function localSearchBills(
  term: string,
  sessionYear?: number,
  limit = 25,
  offset = 0
): Promise<{ items: Record<string, unknown>[]; size: number } | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    let sql: string;
    let params: unknown[];
    if (sessionYear) {
      sql = `
        SELECT b.raw_json, bfts.rank
        FROM bills_fts bfts
        JOIN bills b ON b.rowid = bfts.rowid
        WHERE bills_fts MATCH ? AND b.session_year = ?
        ORDER BY bfts.rank
        LIMIT ? OFFSET ?
      `;
      params = [term, sessionYear, limit, offset];
    } else {
      sql = `
        SELECT b.raw_json, bfts.rank
        FROM bills_fts bfts
        JOIN bills b ON b.rowid = bfts.rowid
        WHERE bills_fts MATCH ?
        ORDER BY bfts.rank
        LIMIT ? OFFSET ?
      `;
      params = [term, limit, offset];
    }
    const rows = (db as any).prepare(sql).all(...params) as Array<{ raw_json: string; rank: number }>;
    const items = rows.map((r) => ({ result: JSON.parse(r.raw_json), rank: r.rank }));
    return { items, size: items.length };
  } catch {
    return null;
  }
}

export async function localListBills(
  sessionYear: number,
  limit = 25,
  offset = 0
): Promise<{ items: Record<string, unknown>[]; size: number } | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const rows = (db as any)
      .prepare("SELECT raw_json FROM bills WHERE session_year=? ORDER BY published_date DESC LIMIT ? OFFSET ?")
      .all(sessionYear, limit, offset) as Array<{ raw_json: string }>;
    const items = rows.map((r) => JSON.parse(r.raw_json));
    return { items, size: items.length };
  } catch {
    return null;
  }
}

// ─── Laws ─────────────────────────────────────────────────────────────────────

export async function localListLaws(): Promise<Record<string, unknown>[] | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const rows = (db as any)
      .prepare("SELECT raw_json FROM law_trees ORDER BY law_id")
      .all() as Array<{ raw_json: string }>;
    return rows.map((r) => JSON.parse(r.raw_json));
  } catch {
    return null;
  }
}

export async function localGetLawTree(lawId: string): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const row = (db as any)
      .prepare("SELECT raw_json FROM law_trees WHERE law_id=? LIMIT 1")
      .get(lawId.toUpperCase()) as { raw_json: string } | undefined;
    return row ? JSON.parse(row.raw_json) : null;
  } catch {
    return null;
  }
}

export async function localGetLawSection(
  lawId: string,
  locationId: string
): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const row = (db as any)
      .prepare("SELECT raw_json, has_text FROM law_sections WHERE law_id=? AND location_id=? LIMIT 1")
      .get(lawId.toUpperCase(), locationId) as { raw_json: string; has_text: number } | undefined;
    if (!row) return null;
    // If text was not fetched (--include-law-text not used), return null to trigger API fallback for text
    if (!row.has_text) return null;
    return JSON.parse(row.raw_json);
  } catch {
    return null;
  }
}

// ─── Members ──────────────────────────────────────────────────────────────────

export async function localListMembers(
  sessionYear: number,
  chamber: string,
  limit = 100,
  offset = 0
): Promise<{ items: Record<string, unknown>[]; size: number } | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const rows = (db as any)
      .prepare("SELECT raw_json FROM members WHERE session_year=? AND chamber=? ORDER BY short_name LIMIT ? OFFSET ?")
      .all(sessionYear, chamber.toUpperCase(), limit, offset) as Array<{ raw_json: string }>;
    const items = rows.map((r) => JSON.parse(r.raw_json));
    return { items, size: items.length };
  } catch {
    return null;
  }
}

export async function localGetMember(
  sessionYear: number,
  chamber: string,
  memberId: number
): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const row = (db as any)
      .prepare("SELECT raw_json FROM members WHERE session_year=? AND chamber=? AND member_id=? LIMIT 1")
      .get(sessionYear, chamber.toUpperCase(), memberId) as { raw_json: string } | undefined;
    return row ? JSON.parse(row.raw_json) : null;
  } catch {
    return null;
  }
}

// ─── Committees ───────────────────────────────────────────────────────────────

export async function localListCommittees(
  sessionYear: number,
  chamber: string,
  limit = 100,
  offset = 0
): Promise<{ items: Record<string, unknown>[]; size: number } | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const rows = (db as any)
      .prepare("SELECT raw_json FROM committees WHERE session_year=? AND chamber=? ORDER BY name LIMIT ? OFFSET ?")
      .all(sessionYear, chamber.toUpperCase(), limit, offset) as Array<{ raw_json: string }>;
    const items = rows.map((r) => JSON.parse(r.raw_json));
    return { items, size: items.length };
  } catch {
    return null;
  }
}

export async function localGetCommittee(
  sessionYear: number,
  chamber: string,
  name: string
): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const row = (db as any)
      .prepare("SELECT raw_json FROM committees WHERE session_year=? AND chamber=? AND name=? LIMIT 1")
      .get(sessionYear, chamber.toUpperCase(), name) as { raw_json: string } | undefined;
    return row ? JSON.parse(row.raw_json) : null;
  } catch {
    return null;
  }
}

// ─── Agendas ──────────────────────────────────────────────────────────────────

export async function localListAgendas(
  year: number,
  limit = 50,
  offset = 0
): Promise<{ items: Record<string, unknown>[]; size: number } | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const rows = (db as any)
      .prepare("SELECT raw_json FROM agendas WHERE year=? ORDER BY agenda_no DESC LIMIT ? OFFSET ?")
      .all(year, limit, offset) as Array<{ raw_json: string }>;
    const items = rows.map((r) => JSON.parse(r.raw_json));
    return { items, size: items.length };
  } catch {
    return null;
  }
}

export async function localGetAgenda(
  year: number,
  agendaNo: number
): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const row = (db as any)
      .prepare("SELECT raw_json FROM agendas WHERE year=? AND agenda_no=? LIMIT 1")
      .get(year, agendaNo) as { raw_json: string } | undefined;
    return row ? JSON.parse(row.raw_json) : null;
  } catch {
    return null;
  }
}

// ─── Calendars ────────────────────────────────────────────────────────────────

export async function localListCalendars(
  year: number,
  limit = 50,
  offset = 0
): Promise<{ items: Record<string, unknown>[]; size: number } | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const rows = (db as any)
      .prepare("SELECT raw_json FROM calendars WHERE year=? ORDER BY calendar_no DESC LIMIT ? OFFSET ?")
      .all(year, limit, offset) as Array<{ raw_json: string }>;
    const items = rows.map((r) => JSON.parse(r.raw_json));
    return { items, size: items.length };
  } catch {
    return null;
  }
}

export async function localGetCalendar(
  year: number,
  calendarNo: number
): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const row = (db as any)
      .prepare("SELECT raw_json FROM calendars WHERE year=? AND calendar_no=? LIMIT 1")
      .get(year, calendarNo) as { raw_json: string } | undefined;
    return row ? JSON.parse(row.raw_json) : null;
  } catch {
    return null;
  }
}

// ─── Transcripts ──────────────────────────────────────────────────────────────

export async function localListFloorTranscripts(
  year: number,
  limit = 50,
  offset = 0
): Promise<{ items: Record<string, unknown>[]; size: number } | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const rows = (db as any)
      .prepare("SELECT raw_json FROM floor_transcripts WHERE year=? ORDER BY date_time DESC LIMIT ? OFFSET ?")
      .all(year, limit, offset) as Array<{ raw_json: string }>;
    const items = rows.map((r) => JSON.parse(r.raw_json));
    return { items, size: items.length };
  } catch {
    return null;
  }
}

export async function localGetFloorTranscript(
  dateTime: string
): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const row = (db as any)
      .prepare("SELECT raw_json, has_text FROM floor_transcripts WHERE date_time=? LIMIT 1")
      .get(dateTime) as { raw_json: string; has_text: number } | undefined;
    if (!row || !row.has_text) return null;
    return JSON.parse(row.raw_json);
  } catch {
    return null;
  }
}

export async function localListHearingTranscripts(
  year: number,
  limit = 50,
  offset = 0
): Promise<{ items: Record<string, unknown>[]; size: number } | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const rows = (db as any)
      .prepare("SELECT raw_json FROM hearing_transcripts WHERE year=? ORDER BY date DESC LIMIT ? OFFSET ?")
      .all(year, limit, offset) as Array<{ raw_json: string }>;
    const items = rows.map((r) => JSON.parse(r.raw_json));
    return { items, size: items.length };
  } catch {
    return null;
  }
}

export async function localGetHearingTranscript(
  filename: string
): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const row = (db as any)
      .prepare("SELECT raw_json, has_text FROM hearing_transcripts WHERE filename=? LIMIT 1")
      .get(filename) as { raw_json: string; has_text: number } | undefined;
    if (!row || !row.has_text) return null;
    return JSON.parse(row.raw_json);
  } catch {
    return null;
  }
}
