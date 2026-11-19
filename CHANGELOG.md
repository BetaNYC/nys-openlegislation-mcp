# Changelog

All notable changes to `@betanyc/nys-openlegislation-mcp` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-11-19

Adds `about_data`, the third tool BetaNYC is adding to each of its MCP servers, and moves to
shared module 1.5.2. Every answer now says where it came from and how current it is. Fixes the
local copy's sync times and a repeated result in live paging. This release was prepared as
2.7.0; it is 3.0.0 because the changes below under "Breaking changes" can break a caller that
worked with 2.6.0 (Semantic Versioning). Tracking: BetaNYC/betanyc-ai-workspace#1655 and
#1672 (epic #1652); epic #29.

### Breaking changes

Each item compares with 2.6.0 and says what a caller must do differently.

- **The end of every data answer changed.** 2.6.0 ended each answer with a `---` line and
  "Data sourced from the NYS Open Legislation API, maintained by the New York State Senate. …
  Verify critical information at legislation.nysenate.gov." After the same `---` line there
  are now: on a list, a paging line; on a list from the local copy, an order line; the
  source line from the shared `provenance()` (`BetaNYC modified this data: <what BetaNYC
  did>. This copy should not be considered the official record.`, then the fetch time in
  New York time to the minute for a live answer, or `As of <date> …` for the local copy,
  then `Official record: Open Legislation API (New York State Senate),
  https://legislation.nysenate.gov/`); sometimes a note about the local copy's date; and the
  caveat to verify at legislation.nysenate.gov. *What to do:* take the JSON from before the
  first `\n\n---\n`, as before, and do not look for the old "Data sourced from" sentence.
- **Every list tool's `limit` has a maximum, a higher one is lowered, and bad numbers are
  refused.** In 2.6.0 only `search_bills` and `search` (100) and `list_bills` and
  `get_bill_updates` (500) had a maximum, and a higher `limit` was an error. Now a higher
  `limit` is lowered to the maximum, and the paging line says "limit lowered to N". The
  tools that had none now have one: `search_members` and `get_committee_meetings` 100;
  `list_members`, `list_committees`, `list_calendars`, `list_agendas`,
  `list_floor_transcripts` and `list_hearing_transcripts` 200; `get_updates` 500. A `limit`
  under 1, a negative `offset`, or a number that is not whole is now an error. *What to do:*
  ask for the next page with `offset` instead of a bigger `limit`, and send whole numbers.
- **A live `offset` now really counts from 0.** In 2.6.0, `offset: 0` and `offset: 1`
  returned the same first page, and each page started with the last result of the page
  before. *What to do:* if you sent `offset + 1` to get around that, send `0`, `25`, `50` …
  now; otherwise you skip a result.
- **Local `search_bills` results have no `rank`.** The local copy's full-text score was put
  in `rank`, the Senate's own field name. It is now `betanyc.search_score` (lower is a closer
  match). *What to do:* read `betanyc.search_score`; `rank` is only in the Senate's live
  results.
- **Local `search_members` keeps the Senate's `fullName` and `chamber`.** 2.6.0 replaced
  them with values from the local copy. Now they are filled only when the Senate's member
  record lacks them, and `betanyc.filled` lists what was filled. *What to do:* expect the
  Senate's spelling of a name; read `betanyc.filled` to see which values BetaNYC added.
- **The local copy's `source` field reads differently.** In 2.6.0 it was always
  `local corpus (synced <time with no zone>)`. The time now has its zone, and for laws,
  members, committees and transcripts it gives that type's download date, or says that date
  is not recorded (for example `local corpus (laws downloaded <time>; the nightly sync does
  not update laws)`). *What to do:* do not read a date out of `source` with a fixed pattern;
  the source line at the end of the answer says the same in words.
- **Error text changed.** Errors are still `isError: true`, but the text is now a plain
  sentence that says what to try, not `NYS Open Legislation API error <status>: …` or
  `API returned failure: …`, and the API key is never in it. *What to do:* check `isError`,
  not the words.
- **For people who keep a local copy:** `sync_state.last_synced_at` is now stored with its
  New York offset (for example `2026-11-13T16:58:00-05:00`), not as UTC with no zone, and
  `scripts/fetch-data.js` exits with code 1 when any item failed to download, without saving
  that type's date. *What to do:* a script that reads `last_synced_at` must read the offset;
  a scheduled job should treat exit code 1 as "run the command it printed again".

### Added

- `about_data`: where this server's data comes from, answered from the new
  `DATA-SOURCES.json` (the about-data standard). Two topics: `live` (the Senate's
  Open Legislation API, asked when you ask) and `corpus` (the local copy built with
  `scripts/fetch-data.js` and `scripts/sync.js`). A tool name works as a topic too.
  Each answer names the source and its publisher (the New York State Senate), says
  the records are the Senate's official records and that BetaNYC reshapes them, so
  this copy is not the official record (shared module 1.4.0), how current the
  data is on this server, the terms, where to check a record and where to report an
  error, and gives BetaNYC's address for questions, lab@beta.nyc.
- Without `NYS_LEGISLATION_API_KEY`, `about_data` says the live source is not
  available on this server instead of "fetched when you ask"; without a local copy,
  it says the same for `corpus` (`unavailableSources`, shared module 1.3.7 and later). With a
  copy, the `corpus` date is its `last_synced_at`, read from the copy with no
  network call and shown with its time zone (see Fixed).
- `data.json`, a DCAT-US 3.0 catalog built from `DATA-SOURCES.json` by
  `scripts/whats_changed.py about-data catalog` (never edited by hand). Both files
  ship in the npm package.
- The server now sends MCP `instructions`: what it covers, and when to call
  `about_data`, `about_betanyc` and `whats_changed`.
- A test fails when any tool has no source in `DATA-SOURCES.json`
  (`assertEveryToolExplained`), so a new tool cannot ship unexplained.
- CI: an `about-data` job checks `DATA-SOURCES.json` against the server's real tool
  list, checks `data.json` is current, and validates both against the JSON Schema
  and DCAT-US 3.0 with pinned validators. The release workflow runs
  `about-data check --release` before `npm publish`.

### Changed

- 27 tools instead of 26.
- Shared module 1.5.2: `src/betanyc-tools.ts` is BetaNYC's shared module 1.5.2, and
  `scripts/whats_changed.py` and the about-data validator kit
  (`scripts/tests/catalog_validate.py`, `scripts/mcp_shared/data-sources.schema.json`)
  are those of `whats_changed.py` 1.4.1, all copied in unchanged
  (`whats_changed_drift.py scan`: CURRENT). Never edit the copies. 1.5.0 adds helpers
  for a server's own tools and changes none of the three shared tools (#30). 1.5.1
  (canonical commit `17938f2`; the file's own stamp, the sha256 of the file without its
  stamp line, is `e1e15642…`) tightens them: `assertEveryToolAnnotated` requires
  `readOnlyHint: true`, a boolean `openWorldHint` and a title; `annotateTools(tools,
  boolean)` lets a tool's own hint win; `provenance()` gives a live answer's fetch time in
  New York time to the minute and labels a live `asOf` as the data's own date (new fields
  `as_of_kind: "source"` and `retrieved_at`), and refuses links with a username or
  password and names with control characters; `toolError` redacts more encoded forms of
  a secret and ignores secrets under 8 characters. 1.5.2 (canonical commit `bbc1671`;
  raw file sha256 `bcc117e7…`, 125,208 bytes; the file's own stamp, the sha256 without its
  stamp line, is `eb29cbfb…`): `toolError` drops stack-frame lines from the caller's
  message too and caps it at 1,000 characters; new `errorSummary(err, max)` gives the
  first plain line of an unknown error; `provenance()` takes `changedByBetanyc` and then
  says, in `about_data`'s own words, that BetaNYC modified or produced the data.
- Every tool now declares `annotations` (`annotateTools`, #31): `readOnlyHint: true`,
  a `title`, and `openWorldHint` (true for the 24 Open Legislation tools, which may
  call the live API; false for the three shared tools). `test/tool-list.test.js`
  fails on a tool without them.
- `test/tool-list.test.js` also caps the tool list plus the server instructions at
  28,500 characters (`toolListSize`; measured 28,077 on 2026-11-18, #39; 28,362 after
  the session-year hint went back on).
- Requests to the Open Legislation API go through `src/http.ts` (#32), following the
  API's rate-limit rules (per key from December 1, 2026: 10 requests per second, 4 in
  progress): one request at a time, at least 100 ms apart; a 30 s timeout and no
  resend after it; at most two retries, only on 429 and 503, waiting at least
  `Retry-After` (whole seconds) plus jitter, or 1 s then 2 s without it; a
  `Retry-After` over 30 s is reported, not waited out. A User-Agent names the
  package and version. Before, `apiFetch` called `fetch(url)` with none of these.
- Errors (#38): every failure is `isError: true` with a plain sentence and what to try
  (by HTTP status, timeout, network failure, `success: false`, bad arguments), built
  with the shared `toolError`: at most 500 characters of the upstream body, no stack
  lines. Argument errors name the field instead of dumping zod's JSON.
- The API key is redacted from every error (#37), raw and URL-encoded. The API takes it
  only as the `key` query parameter (API Conventions, "Base URL and API key"), so it
  stays there. `test/upstream.test.js` covers all three.
- Every data answer names its source and how current it is (#33, #34): after the JSON,
  a line from the shared `provenance()` (see Breaking changes for its words). It says what
  BetaNYC did to the data, in the words `about_data` uses: for a live answer, that it is
  passed on as the API returns it with additions that change no value (paging totals,
  links to nysenate.gov, an empty vote list for a bill with none); for the local copy,
  that it is a copy BetaNYC saved and indexed, whose search and list order are BetaNYC's
  own. Then the official record, https://legislation.nysenate.gov/, and the fetch time
  (New York time) for a live call. For a local one it gives the date of that type of data
  (`src/corpusDates.ts`): `last_synced_at` for bills, agendas and calendars, the only
  types `scripts/sync.js` refreshes; for laws, members, committees and transcripts, the
  time `scripts/fetch-data.js` last downloaded that type, which it now records as
  `sync_state.fetched_at_<type>`. A copy with no such time says the date is not
  recorded and that the data comes from the last full download, never the sync time
  ("As of: unknown" when there is no readable date). `test/corpus-dates.test.js` covers
  each type, and every single-item tool. `about_data`'s "How current on this server" for
  the local copy says the same per type, not the sync time for everything. A list from the
  local copy also says its order is the copy's own (for example, bills newest published
  first), so its page 1 can differ from the Senate's. It replaces the disclaimer's "Data sourced from"
  sentence; the caveat to verify at legislation.nysenate.gov stays.
- Lists (#35): every list tool's `limit` now has a maximum, stated in its schema
  (`search_bills`, `search_members`, `get_committee_meetings`, `search`: 100;
  `list_members`, `list_committees`, `list_calendars`, `list_agendas`, both transcript
  lists: 200; `list_bills`, `get_bill_updates`, `get_updates`: 500). A whole-number
  `limit` above it is lowered to it, and the paging line says "limit lowered to N, the
  most this tool returns". A `limit` under 1, a negative `offset` and a number that is
  not whole are refused with a plain message. Defaults are unchanged.
  Each list answer says which results it shows, of how many (live answers carry the
  API's `total`), and the `offset` for the next page; the local copy has no total, so a
  full page says more may be available, and a short one says it is all the local copy
  has. `test/answers.test.js` checks it on a
  25,520-bill fixture.
- The server instructions now say once what several tools used to repeat (#42): session
  years, ElasticSearch query syntax, `limit`/`offset` paging, and the source line at the
  end of each answer. The tool descriptions are shorter; the shared about_data paragraph
  is unchanged. Each `session_year` parameter keeps a short "(odd year, e.g. 2025)",
  since some AI apps ignore server instructions.
- An unknown parameter's error is passed on once ("search_bills does not accept 'x'. …"),
  not wrapped as "search_bills failed: search_bills does not accept …" (`ParseArgsError`). `test/tool-list.test.js` fails if a sentence repeats across tools.

### Added (tests)

- `eval/` (#40): 12 realistic questions with known answers, written before scoring, run
  offline against fixtures from the API documentation's example responses
  (`npm run eval`, results in `eval/runs/`; also run by `npm test`).
- `test/stdout.test.js` (#41): starts the server and fails on any stdout line that is not
  a JSON-RPC message, and on any direct stdout write in `src/`.
- The shared tools are dispatched with `callAsync`, because the corpus freshness
  hook reads the local copy asynchronously.

### Fixed

- **`fetch-data.js` saved a download date even when the download failed.** `fetchLaws`
  and `fetchTranscripts` carry on past a failed item; the date was saved anyway, so old
  data claimed the new date. A type's date is now saved only when every item came
  through; otherwise the run exits non-zero and says how many items failed and what to
  run again. `test/fetch-data-dates.test.js` covers laws and transcripts with every,
  some and no request failing.
- A network error with no error code showed the whole cause message, stack lines
  included. It now shows only its first plain line (shared `errorSummary`).

- **Live paging repeated one result (since 1.0.0, #36).** The tools' `offset` counts
  from 0, but the API's counts from 1 (API Conventions, "Paging"), and it was sent
  unchanged: `offset: 0` and `offset: 1` returned the same first page. Paging by 25 sent
  offsets 0, 25, 50 as 1, 25, 50, so the pages were results 1–25, 25–49, 50–74: result
  25 came twice, as the last of page 1 and the first of page 2, and no other result
  repeated. Nothing was skipped; a count made by paging was one too high. Live calls now
  send `offset + 1`. Answers from the local copy were not affected.

- **The local copy's sync missed changes after every sync (since 2.0.0).** The
  Open Legislation API reads every date and time as New York local time with no
  offset, and ignores an offset it is sent (API Conventions, "Dates and times").
  `scripts/sync.js` sent `new Date().toISOString().split(".")[0]`, the UTC time with
  its `Z` cut off, as the end of each update range, and stored it as the next
  range's start; `scripts/fetch-data.js` seeded the watermark the same way, after
  the load. So each range ended four or five hours in the future, and changes the
  Senate processed in that window, and during the first download, were never
  fetched. Now, following "Keeping Up with Changes":
  - each range ends at New York now minus 2 minutes, sent as New York wall time
    (`scripts/lib/ny-time.js`, through `Intl` with `America/New_York`, so daylight
    saving time is handled by the time zone database);
  - `last_synced_at` is stored with its New York offset (for example
    `2026-11-13T16:58:00-05:00`), one exact instant even in the repeated hour in
    November;
  - `fetch-data.js` notes the time before the load, not after, and never moves an
    existing watermark forward (a later `--types=committees` load used to reset it
    and make the next sync skip bill changes);
  - `--from` is read as New York local time, the API's own convention, or converted
    if it carries a zone.
- **Old corpora.** A `last_synced_at` with no zone can only have been written by an
  earlier version, as UTC, so it is read as UTC: the next sync starts from the
  instant the last one really ran, in New York time, and then stores the zoned
  form. Nothing is rewritten in place. Changes missed by earlier syncs are picked up
  by running the sync once with `--from` set to the day the copy was built.
- **Readers.** Local answers' `source: "local corpus (synced …)"` and `about_data`'s
  corpus date showed the stored value with no zone. Both now show it with its zone
  (`src/syncTime.ts`): the stored offset, or `Z` for an old UTC value.

## [2.6.0] - 2026-11-13

Adds the two tools BetaNYC is adding to each of its MCP servers. Tracking:
BetaNYC/betanyc-ai-workspace#1645 (epic #1637).

### Added

- `whats_changed`: what changed in this server, newest first, from
  `WHATS-CHANGED.md` (filters: `since`, `tag`, `limit`). Answers with readable
  text and `structuredContent` matching a declared `outputSchema`.
- `about_betanyc`: who built the server, the repository, where to report a
  problem, and BetaNYC's links.
- `src/betanyc-tools.ts`, copied unchanged from the workspace's
  `scripts/mcp_shared/betanyc-tools.ts` (shared module v1.2.1). Never edit the
  copy; change the canonical file and copy it again. The two tools answer about
  the server, not from Open Legislation data, so their text carries no data
  disclaimer.
- `WHATS-CHANGED.md`, the reader-facing record of changes, backfilled to 1.0.0
  and shipped in the npm package (`files`). `scripts/whats_changed.py` (copied
  unchanged from the workspace) checks it.
- CI: a `whats-changed` job runs `whats_changed.py check --base-ref` (old
  entries are append-only, and a version bump needs an entry). The release
  workflow runs `check --release` before `npm publish`, so a release cannot ship
  while the `WHATS-CHANGED.md` entry still says `Unreleased`.

### Changed

- 26 tools instead of 24.

## [2.5.1] - 2026-11-09

### Added

- **Listing in the official MCP Registry** as
  `io.github.BetaNYC/nys-openlegislation-mcp`. `package.json` now carries
  `mcpName`, which the registry checks on the published npm package, so this
  release exists to ship it. `server.json` describes the listing, and
  `.github/workflows/publish-mcp.yml` publishes it after a successful Release.
- **`glama.json`**, which claims the server on Glama for its maintainers.

### Changed

- The Release workflow checks that `server.json` and `package.json` agree on
  name and version before publishing to npm.

## [2.5.0] - 2026-10-22

### Added

- **`nysenate_url` on law documents**
  ([#18](https://github.com/BetaNYC/nys-openlegislation-mcp/issues/18)).
  `get_law_section` records and `search` results of `type: "laws"` carry a
  citation link for `SECTION` and `ARTICLE` documents, and `null` for any
  other type, so callers never have to build one from a pattern.
- **Live API responses keep `total`, `offsetStart`, `offsetEnd` and `limit`.**
  They sit on the API envelope, beside `result`, and were being dropped, so a
  caller could not tell a full page from the last one. Results served from the
  local corpus do not carry them yet.

### Fixed

- **`serverInfo` reports the real version.** 2.4.0 still said 2.3.0; the
  version is now read from `package.json`.

### Changed

- **`src/db.ts` rewritten around three helpers**
  ([#19](https://github.com/BetaNYC/nys-openlegislation-mcp/issues/19)),
  468 → 266 lines, with a new test pinning every local query's behavior. No
  change to what any local-corpus query returns. `getDbPath`, `hasLocalCorpus` and
  `getSyncState` are kept: they have callers.
- `get_bill_updates` now uses the same code as `get_updates` with
  `content_type: "bills"`; the duplicate `getBillUpdates` is gone (#19).
- Removed `getBill`'s unused `fullText` parameter, which requested the
  no-full-text view when set to true (#19).

## [2.4.0] - 2026-10-11

### Fixed

- **`get_bill_votes` no longer returns 404 for every bill**
  ([#20](https://github.com/BetaNYC/nys-openlegislation-mcp/issues/20)).
  It requested `/bills/{session}/{printNo}/votes`, which is not an Open
  Legislation route. Votes are part of the bill record
  ([docs](https://legislation.nysenate.gov/static/docs/html/bills.html#get-a-single-bill)),
  so the tool now fetches the bill with `view=no_fulltext` and returns its
  `votes` block. A bill with no recorded votes returns an empty list.
- **`session_year` now actually filters `search_bills` and `search` (`type: "bills"`)**
  ([#21](https://github.com/BetaNYC/nys-openlegislation-mcp/issues/21)).
  The year was sent as a `session` query parameter, which the API ignores, so
  results spanned every session. It now goes in the path, `/bills/{sessionYear}/search`,
  as [documented](https://legislation.nysenate.gov/static/docs/html/bills.html#search-for-bills).
  The `search_bills` schema no longer claims a current-session default it never
  applied: omit `session_year` to search all sessions.
- **`get_member` no longer returns a member from the wrong chamber**
  ([#17](https://github.com/BetaNYC/nys-openlegislation-mcp/issues/17)).
  When the local lookup correctly missed, the live fallback ignored `chamber`
  and returned, for example, an Assembly member for a Senate-scoped request.
  A chamber mismatch is now an error that names the member's real chamber.
- **`search_members` can be disambiguated** (#17). `chamber` now filters (it was
  sent as a query parameter the API ignores; it is now an ElasticSearch
  `chamber:` field clause, per the
  [search docs](https://legislation.nysenate.gov/static/docs/html/search_api.html#term)),
  the session year goes in the path (`/members/{sessionYear}/search`), and
  `full=true` is requested, so every row carries `fullName` and `chamber`.
  `session_year` now defaults to the current session, as the schema already said.

### Added

- **`search_members` is served from the local corpus, including without an API key** (#17).
  A case-insensitive name match over short and full names, with chamber and
  session filtered in SQL. Terms that match nothing locally (for example
  ElasticSearch field queries) fall through to the live API when a key is set.
- **`members.full_name` in the corpus**, filled from bill sponsor records the
  corpus already holds, by both `npm run sync` and `fetch-data.js`. No extra API
  calls; existing corpora gain the column on their next sync.

## [2.3.0] - 2026-07-22

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
