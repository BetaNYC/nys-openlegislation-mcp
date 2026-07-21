# Changelog

All notable changes to `@betanyc/nys-openlegislation-mcp` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.3.0] - unreleased

### Changed

- **The server now starts without an API key when a local corpus is present**
  ([#13](https://github.com/BetaNYC/nys-openlegislation-mcp/issues/13)).
  Previously a missing `NYS_LEGISLATION_API_KEY` was fatal: `src/index.ts`
  called `process.exit(1)` before a server object existed, so MCP clients showed
  "server failed to start" or simply never listed the tools — and a perfectly
  usable local corpus on disk was thrown away. The key and the corpus are now
  checked independently, and the server refuses to start only when **both** are
  missing, which is the genuinely unusable case. The active mode
  (hybrid / live-only / local-only) is logged to stderr at startup; stdout stays
  reserved for the MCP JSON channel.
- **Locally-served results say what would refresh them when keyless.**
  `annotateLocalResult` already stamped `source: "local corpus (synced <ts>)"`.
  In local-only mode the payload now also carries `freshness`, naming the env
  var to set and the `npm run sync` that refreshes the corpus. A consuming model
  needs to be able to tell the user *why* data may be stale and *what to do*,
  not merely that a sync date exists. Nothing changes when a key is set.

### Fixed

- **An empty local result in keyless mode no longer reads as "does not exist."**
  Empty local results fall through to the live API by design — the corpus may
  not have synced that slice yet. With no key there is nothing to fall through
  to, so returning a bare empty payload would answer a question the server
  cannot actually answer. Keyless empty results now return
  `result: "not_found_in_local_corpus"` with an explanation that existence is
  unconfirmed and a live lookup is what would confirm it.
- **Live-only tools now refuse by name rather than failing opaquely.** The 6 of
  24 tools with no local path (`get_bill_votes`, `get_bill_updates`,
  `search_members`, `get_committee_meetings`, `get_updates`, `search`) return
  `Tool '<name>' requires the live NYS Open Legislation API`, followed by where
  to get a free key and how to set it. The guard lives in `buildUrl`, which
  every live call already routes through, so there is no allowlist of live-only
  tools to keep in sync and tools added later are covered automatically.

## [2.2.0] - unreleased

### Fixed

- **Unknown tool parameters are now rejected instead of silently dropped**
  ([#11](https://github.com/BetaNYC/nys-openlegislation-mcp/issues/11)). zod
  strips unrecognized keys by default, so a call like
  `search_members(term="Gonzalez", chamber="senate", bogus_unknown_param="x")`
  returned real, correctly-sourced member records with nothing signalling that a
  filter had been discarded — a consuming model cannot detect that, and will
  summarize the result as if it answered the question asked. Two layers now
  close it: every advertised `inputSchema` sets `additionalProperties: false`
  (which is what makes the *calling* model aware the parameter is invalid), and
  every argument parse goes through a strict `parseArgs` helper that names both
  the offending key and the parameters the tool does accept. All 24 tools are
  covered; `test/strict-schema.test.js` asserts the schema property across the
  whole tool array, so tools added later are covered too.

### Changed

- Tool definitions moved to `src/tools.ts` (exported as `TOOLS`) and tool
  dispatch to `src/handlers.ts` (exported as `callTool`), leaving `src/index.ts`
  as server wiring only. No tool, parameter, or response shape changed — this
  lets tests exercise tool dispatch without starting a stdio server.

## [2.1.1] - 2026-07-07

### Fixed

- `fetch-data.js` now walks the full law document tree. `flattenLawTree` recursed
  via a non-existent `node.children` key, so every one of the 137 law bodies
  collapsed to just its root node (137 `law_sections` rows total, and zero
  section text even with `--include-law-text`). Child documents are nested under
  `documents.items` (a `{ items, size }` wrapper), confirmed live against
  `GET /api/3/laws/{lawId}` on 2026-07-07 — Penal Law alone now yields ~900
  section rows. The helper is extracted to `scripts/lib/law-tree.js` with
  hermetic regression tests.
- `LawTreeNode` / `LawTree` types in `src/laws.ts` corrected to the real API
  shape (node fields sit directly on the node; children nest under
  `documents.items`, not a `lawVersion` wrapper + `children` array). Types only —
  no runtime behavior change in the published server.

## [2.1.0] - 2026-07-06

### Fixed

- Transcript endpoints corrected to `/transcripts/{year|dateTime}` and
  `/hearings/{year|filename}` (the old `/transcripts/floor/...` and
  `/transcripts/hearing/...` routes do not exist); `fetch-data.js` no longer
  silently swallows transcript failures, and `--include-transcript-text`
  actually fetches text per item.
- `get_member` uses the documented `/members/{sessionYear}/{memberId}` route;
  `chamber` is retained for local-corpus lookups only.
- Empty local-corpus results (0 items) now fall through to the live API instead
  of shadowing live data; `get_law_tree` serves a real tree from a new
  `tree_json` column instead of a stub.
- `sync.js` pagination uses 1-based offsets and the envelope `total` (no more
  page-size-as-total or one-row overlap per page), and leaves the
  `last_synced_at` watermark untouched when any item fails.
- Amended bills no longer freeze: bills are keyed by `basePrintNo` with the
  amendment letter kept in a new `active_version` column; idempotent
  `ALTER TABLE`s upgrade existing corpora.
- `get_updates` `type` param now correctly selects the timestamp
  (`processed` | `published`) per the API docs.
- Dead committee sync branch removed (the aggregate updates feed never carries
  committee content); documented as a known limitation instead.

### Added

- Local-first results are annotated with
  `"source": "local corpus (synced <date>)"` so staleness is visible.
- `get_updates` gains a `content_type` param (`bills` | `agendas` |
  `calendars` | `laws`) routing to the documented per-content updates
  endpoints.
- `NYS_CORPUS_DB` environment variable overrides the corpus location for both
  the server and the scripts.
- Shared `scripts/lib/api-helpers.js` (1-based pagination math,
  `basePrintNo`) used by both fetch and sync scripts.
- README: Known limitations section; local-corpus setup now documents the git
  clone requirement (scripts are not published to npm) and the Node >= 20
  requirement.

### Changed

- `better-sqlite3` (+ types) moved to `optionalDependencies` so a failed
  native build no longer breaks `npx` installs; both scripts import it
  dynamically with a clear error message, and the server degrades to
  API-only mode.
- Node engines floor raised to `>=20` (better-sqlite3 v12 supports 20.x+).

## [2.0.1] - 2026-07-06

### Fixed

- Search now routes to the per-type `/{type}/search` endpoints; the nonexistent
  aggregate `/search` endpoint is no longer used, restoring working search results.
- `better-sqlite3` reclassified from devDependency to a regular dependency so
  npm installs include it.
- Dependency override pinning `hono` to `>=4.12.25 <5` to resolve
  GHSA-wwfh-h76j-fc44.

### Added

- Live search smoke tests (`test/search.live.test.js`) exercising the per-type
  search routes against the real API; skipped when `NYS_LEGISLATION_API_KEY`
  is not set.
- GitHub Actions CI test gate on the supported Node LTS matrix (#4).
- Tag-triggered release automation: pushing a `v*` tag publishes to npm with
  provenance and creates a GitHub Release.

### Changed

- README: clear API-key subsection (#3); corrected API registration URL to
  `/public`.

## [2.0.0] - 2026-05-26

### Added

- Local SQLite corpus with incremental sync — local-first lookups for bills,
  laws, members, committees, calendars, agendas, and transcripts, with live-API
  fallback (#2).

### Changed

- Node engines floor raised to `>=20` (better-sqlite3 v12 requirement).

## [1.0.2] - 2026-05-22

### Fixed

- Bill URLs now use `www.nysenate.gov` so links open without requiring login.

## [1.0.1] - 2026-05-22

### Added

- `url` field on bill results.

## [1.0.0] - 2026-05-22

### Added

- Initial release: MCP server for New York State legislation via the NYS Open
  Legislation API — bills, laws, members, committees, calendars, agendas,
  transcripts, updates, and search.

[Unreleased]: https://github.com/BetaNYC/nys-openlegislation-mcp/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/BetaNYC/nys-openlegislation-mcp/compare/v2.0.1...v2.1.0
[2.0.1]: https://github.com/BetaNYC/nys-openlegislation-mcp/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/BetaNYC/nys-openlegislation-mcp/compare/v1.0.2...v2.0.0
[1.0.2]: https://github.com/BetaNYC/nys-openlegislation-mcp/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/BetaNYC/nys-openlegislation-mcp/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/BetaNYC/nys-openlegislation-mcp/releases/tag/v1.0.0
