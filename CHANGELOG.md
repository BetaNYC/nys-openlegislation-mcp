# Changelog

All notable changes to `@betanyc/nys-openlegislation-mcp` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

### Changed

- **`npm test` is now offline unconditionally** ([#14](https://github.com/BetaNYC/nys-openlegislation-mcp/issues/14)). The live smoke test moved from `test/search.live.test.js` to `test/live/search.test.js`, outside the default `test/*.test.js` glob, and is run deliberately with the new `npm run test:live`.

  Previously the live test gated itself on `NYS_LEGISLATION_API_KEY` being present. That skipped correctly in CI, which has no key — but on a machine configured to *run* this server the key is exported, so a plain `npm test` quietly made real requests to the NYS Open Legislation API. Key presence was standing in for intent, and those are different things.

  Network access is now a directory boundary rather than an environment check, guarded by `test/offline-by-default.test.js`. `release.yml` runs `npm test --if-present` before publishing, so this also makes the publish path structurally incapable of live calls rather than incidentally offline.

- **`npm run test:live` fails rather than skips when no key is set.** Reaching it means the caller asked for the live suite; a silent skip there reads as a pass. The failure names the key, the registration URL, and the export line.

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
