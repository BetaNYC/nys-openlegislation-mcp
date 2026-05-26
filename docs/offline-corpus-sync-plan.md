# Plan: Offline Corpus + Sync Layer

**Branch:** `feature/offline-corpus-sync`
**Date:** 2026-05-22
**Repo:** `nys-openlegislation-mcp`

---

## Context

The MCP server currently queries the NYS Open Legislation API live for every request. This works but has latency on broad searches and requires network access at query time. A local SQLite corpus with an incremental sync layer gives faster queries, offline capability, and a nightly update pattern rather than per-query API calls.

Full design rationale and decisions are documented in the workspace at:
`betanyc-ai-workspace/docs/work/2026-05-22-nys-openlegislation-local-corpus-plan.md`

---

## Approach

### 1. Add SQLite dependency
Add `better-sqlite3` (synchronous SQLite driver, no async overhead, Node 18+).

### 2. Schema (`scripts/create-db.js`)
Create `data/corpus.db` with tables for bills, laws, members, committees, agendas, calendars, transcripts, and sync_state. Bills and laws get FTS5 virtual tables for full-text search.

### 3. Bulk fetch script (`scripts/fetch-data.js`)
```
node scripts/fetch-data.js [--start-year 2009] [--include-law-text] [--include-transcript-text] [--delay-ms 100]
```
Paginates through all content types from `start_year` to present. Writes to SQLite in batches. Persists config flags in `sync_state`.

### 4. Sync script (`scripts/sync.js`)
```
node scripts/sync.js
```
Reads `last_synced_at` from `sync_state`. Calls the updates feed for the delta window. Fetches changed records individually and upserts. Updates `last_synced_at`.

### 5. DB query layer (`src/db.ts`)
TypeScript module that opens `data/corpus.db` if it exists (returns null immediately if not — preserves current pure-API behavior). Exports query functions mirroring the API module signatures.

### 6. Wire MCP tools to local-first pattern
Each tool handler: query DB → if result, return it; else fall back to live API. Start with `get_bill` and `search_bills`, then extend to all 19 tools.

### 7. Update README and package.json
- Add `fetch-data` and `sync` to `scripts`
- Document setup steps (run fetch-data once, configure cron for sync)
- Add cron example for nightly sync

---

## Critical files

| File | Change |
|---|---|
| `package.json` | Add `better-sqlite3` dependency; add `fetch-data` and `sync` scripts |
| `scripts/fetch-data.js` | New — bulk fetch all content types into SQLite |
| `scripts/sync.js` | New — incremental sync via updates feed |
| `src/db.ts` | New — SQLite query layer, local-first pattern |
| `src/index.ts` | Modified — tool handlers query DB first, fall back to API |
| `src/api.ts` | Minor — expose any helpers needed by db.ts |
| `data/.gitkeep` | New — keep `data/` dir tracked; `corpus.db` gitignored |
| `.gitignore` | Add `data/corpus.db` |
| `README.md` | Add setup section: fetch-data, sync, cron |

---

## Optional content flags

| Flag | Effect | Size impact |
|---|---|---|
| `--include-law-text` | Store full law section text locally | +~1.2 GB |
| `--include-transcript-text` | Store full transcript text locally | +~600 MB |
| Neither (default) | Metadata only; text fetched live on demand | ~300 MB total |

Config persisted in `sync_state` table — sync script inherits without re-passing flags.

---

## Verification

- [ ] `node scripts/fetch-data.js --start-year 2025` completes without error; `data/corpus.db` exists and has rows in all tables
- [ ] `node scripts/sync.js` completes; `sync_state.last_synced_at` advances
- [ ] `get_bill` tool returns a bill from local DB (verify by temporarily blocking network and confirming no API call)
- [ ] `search_bills` FTS5 query returns ranked results matching live API results
- [ ] If `data/corpus.db` is deleted, all 19 tools fall back to live API cleanly
- [ ] `--include-law-text` flag: `get_law_section` returns text from local DB
- [ ] Without flag: `get_law_section` falls back to live API for text

---

## Approval scope

Per workspace durable-files rule, no changes to durable system files are proposed. All changes are in `nys-openlegislation-mcp` source files — no approval gate required beyond normal PR review.

---

## Implementation order

1. `package.json` — add dependency and script entries
2. `scripts/fetch-data.js` — bills only first to prove the pattern
3. `src/db.ts` — bill query functions + FTS5 search
4. Wire `get_bill` + `search_bills` in `src/index.ts`
5. Test end-to-end with Claude Desktop
6. Extend fetch to remaining content types
7. `scripts/sync.js`
8. Wire remaining 17 tools
9. README update
10. Bump to `2.0.0`
