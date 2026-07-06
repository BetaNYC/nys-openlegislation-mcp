# @betanyc/nys-openlegislation-mcp

An MCP server for the [NYS Open Legislation API](https://legislation.nysenate.gov/static/docs/html/index.html), maintained by the New York State Senate. Gives AI assistants direct access to the full NYS legislative record — bills, laws, members, committees, calendars, agendas, and transcripts — covering 150,000+ bills and resolutions dating back to 2009.

Built by [BetaNYC](https://beta.nyc) as part of a suite of civic data MCP servers for New York.

---

## What it covers

| Resource | Tools |
|---|---|
| **Bills** | Search, get by print number, list by session, get votes, track updates |
| **Laws** | List all law bodies, browse law trees, retrieve section text |
| **Members** | List and search Senate and Assembly members |
| **Committees** | List committees, get details and meeting history |
| **Floor Calendars** | List and get Senate floor calendars |
| **Agendas** | List and get committee agendas with vote records |
| **Transcripts** | Floor session and public hearing transcripts |
| **Updates** | Aggregate change feed across all content types |
| **Search** | Full-text ElasticSearch within a content type (bills, laws, agendas, calendars, transcripts, hearings) |

---

## API key

**Yes — a free API key is required.** Get one from the NYS Open Legislation portal and set it as the `NYS_LEGISLATION_API_KEY` environment variable:

1. Register at **[legislation.nysenate.gov/public](https://legislation.nysenate.gov/public)**
2. You'll receive an API key by email
3. Set it as `NYS_LEGISLATION_API_KEY` (e.g. `export NYS_LEGISLATION_API_KEY="your-api-key"`), or pass it in your MCP client's `env` block — see [Installation](#installation)

Bill URLs returned by this server point to the public [nysenate.gov](https://www.nysenate.gov/legislation) website — no login required.

---

## Installation

Requires **Node.js 20 or newer**.

### Use with Claude Desktop (recommended)

**No global install needed.** Add to your Claude Desktop config and `npx` handles the rest.

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nys-openlegislation": {
      "command": "npx",
      "args": ["-y", "@betanyc/nys-openlegislation-mcp"],
      "env": {
        "NYS_LEGISLATION_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Restart Claude Desktop. The server starts automatically.

### Global install

```bash
npm install -g @betanyc/nys-openlegislation-mcp
```

Then in your MCP config:

```json
{
  "mcpServers": {
    "nys-openlegislation": {
      "command": "nys-openlegislation-mcp",
      "env": {
        "NYS_LEGISLATION_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

---

## Local corpus (optional)

By default the server queries the live NYS Open Legislation API on every request. If you run large workloads — bulk research, repeated searches, or offline use — you can build a local SQLite corpus that the server queries first, falling back to the API only on a cache miss.

### Requirements

The fetch and sync scripts (`scripts/`) are **not included in the npm package** — building a local corpus requires a git clone:

```bash
git clone https://github.com/BetaNYC/nys-openlegislation-mcp.git
cd nys-openlegislation-mcp
npm install
```

`better-sqlite3` is an optional dependency. The server works without it — it just means every request goes to the live API. If its native build was skipped, install it explicitly with `npm install better-sqlite3`.

### 1. Fetch the initial corpus

```bash
NYS_LEGISLATION_API_KEY=your-key node scripts/fetch-data.js
```

**Options:**

| Flag | Default | Description |
|---|---|---|
| `--start-year=YYYY` | `2009` | Earliest session year to fetch |
| `--types=bills,laws,...` | all types | Comma-separated list: `bills,laws,members,committees,agendas,calendars,transcripts` |
| `--include-law-text` | off | Fetch full text of every law section (large — adds significant download time) |
| `--include-transcript-text` | off | Fetch full text of floor and hearing transcripts (very large) |
| `--delay-ms=N` | `150` | Delay between API calls in ms |
| `--dry-run` | off | Print what would be fetched without writing |

The corpus lands in `data/corpus.db` (override the location with the `NYS_CORPUS_DB` environment variable — both the server and the scripts honor it). A full fetch without law or transcript text takes **2–6 hours** depending on your start year and network speed. The `--types` flag lets you fetch only what you need.

### 2. Run incremental sync (nightly)

```bash
NYS_LEGISLATION_API_KEY=your-key node scripts/sync.js
```

**Options:**

| Flag | Default | Description |
|---|---|---|
| `--from=YYYY-MM-DDTHH:MM:SS` | last sync time | Override the start datetime |
| `--delay-ms=N` | `150` | Delay between API calls in ms |
| `--dry-run` | off | Print what would be synced without writing |

**Cron example** (nightly at 2am):
```
0 2 * * * NYS_LEGISLATION_API_KEY=your-key node /path/to/scripts/sync.js >> /var/log/nys-sync.log 2>&1
```

### How local-first works

When `data/corpus.db` exists and `better-sqlite3` is available, every tool handler queries the local DB first. If the record is found locally, it returns immediately without an API call, annotated with `"source": "local corpus (synced <date>)"` so staleness is visible. If the record is not found — or the local result is **empty** (0 items) — it falls through to the live API transparently; an empty local slice never shadows live data.

Law section text and transcript full text fall back to the API unless `--include-law-text` / `--include-transcript-text` were used during the initial fetch.

### Known limitations

- **Committees go stale between full fetches.** The incremental sync consumes the aggregate updates feed, which only carries `AGENDA` / `BILL` / `CALENDAR` / `LAW` content types — committee changes never appear in it. Re-run `fetch-data.js --types=committees` periodically (it is a quick fetch) to refresh committee data.
- **Law and transcript text** are not incrementally synced; re-run `fetch-data.js` for those periodically.

---

## Tools

### Bills

| Tool | Description |
|---|---|
| `search_bills` | Full-text bill search with ElasticSearch syntax, optional session year filter |
| `get_bill` | Get a specific bill by print number (e.g. `S1234`) and session year |
| `list_bills` | List bills introduced in a session year |
| `get_bill_votes` | Get committee and floor vote records for a bill |
| `get_bill_updates` | Feed of bill changes within a date range |

### Laws

| Tool | Description |
|---|---|
| `list_laws` | List all NYS law bodies (Education Law, Labor Law, etc.) |
| `get_law_tree` | Get table of contents for a law body |
| `get_law_section` | Get text of a specific law section |

### Members

| Tool | Description |
|---|---|
| `list_members` | List Senate or Assembly members for a session year |
| `get_member` | Get a specific legislator by member ID |
| `search_members` | Search legislators by name |

### Committees

| Tool | Description |
|---|---|
| `list_committees` | List Senate or Assembly committees |
| `get_committee` | Get committee details — chair, schedule, location |
| `get_committee_meetings` | Get meeting history and bills considered |

### Calendars & Agendas

| Tool | Description |
|---|---|
| `list_calendars` | List Senate floor calendars for a year |
| `get_calendar` | Get a specific floor calendar with bill lists |
| `list_agendas` | List committee agendas for a year |
| `get_agenda` | Get a specific agenda with vote records |

### Transcripts

| Tool | Description |
|---|---|
| `list_floor_transcripts` | List Senate floor session transcripts |
| `get_floor_transcript` | Get a specific floor session transcript |
| `list_hearing_transcripts` | List public hearing transcripts |
| `get_hearing_transcript` | Get a specific hearing transcript |

### Updates & Search

| Tool | Description |
|---|---|
| `get_updates` | Aggregate change feed for a date range. `type` selects the timestamp the range filters on (`processed` or `published`); `content_type` restricts to `bills`, `agendas`, `calendars`, or `laws` |
| `search` | Full-text search within one content type — `bills` (default), `laws`, `agendas`, `calendars`, `transcripts`, `hearings`. One type per call; the upstream API has no unified search endpoint. Search resolutions via `type: "bills"`. |

---

## Example queries

Once connected to Claude Desktop, you can ask:

- *"Find NYS bills about congestion pricing introduced in the 2025 session"*
- *"Get the vote record for Senate bill S1234 in the 2025 session"*
- *"What committees does the NYS Senate Finance Committee oversee?"*
- *"Show me the text of Section 701 of the Education Law"*
- *"What NYS legislation changed this week?"*
- *"Search for bills sponsored by Krueger about climate"*

---

## Session years

NYS legislative sessions run in two-year cycles beginning in odd-numbered years. The current session is **2025** (covering 2025–2026). When no session year is specified, tools default to the current session.

---

## Data disclaimer

Results are sourced from the NYS Open Legislation API, maintained by the New York State Senate. Bill text, status, vote records, and law content reflect official legislative data but may be subject to correction or amendment. Verify critical information at [legislation.nysenate.gov](https://legislation.nysenate.gov).

---

## Releases

Releases are automated by [`.github/workflows/release.yml`](.github/workflows/release.yml):

1. Bump `version` in `package.json` in a PR (with a matching `CHANGELOG.md` entry) and merge to main.
2. Tag the merge commit `v<version>` (e.g. `git tag v2.0.1 && git push origin v2.0.1`).
3. The workflow runs the test suite, verifies the tag matches `package.json`, publishes to npm with provenance, and creates a GitHub Release with generated notes.

See [CHANGELOG.md](CHANGELOG.md) for version history. Publishing requires the `NPM_TOKEN` org secret (an npm token with publish rights to the `@betanyc` scope).

---

## About BetaNYC

[BetaNYC](https://beta.nyc) is a civic technology nonprofit improving lives in New York through data, design, and community power. This server is part of a suite of public-interest MCP tools for NYC and NYS civic data.

**Related BetaNYC MCP servers:**

| Server | npm | What it covers |
|---|---|---|
| [nyc-council-mcp](https://github.com/BetaNYC/nyc-council-mcp) | `@betanyc/nyc-council-mcp` | NYC Council bills, hearings, votes via Legistar |
| [nyc-record-mcp](https://github.com/BetaNYC/nyc-record-mcp) | `@betanyc/nyc-record-mcp` | NYC City Record procurement notices |
| [nyc-checkbook-mcp](https://github.com/BetaNYC/nyc-checkbook-mcp) | `@betanyc/nyc-checkbook-mcp` | NYC Checkbook spending, contracts, budget |
| [nyc-charter-laws-rules](https://github.com/BetaNYC/nyc-charter-laws-rules) | `@betanyc/nyc-charter-laws-rules` | NYC Charter, Administrative Code, Rules |

---

## Support our work

Freedom isn't free. [Support BetaNYC](https://beta.nyc/donate/).

## License

MIT © [BetaNYC](https://beta.nyc)
