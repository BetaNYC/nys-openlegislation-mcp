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
| **Search** | Full-text ElasticSearch across all content |

---

## Requirements

A free API key from the NYS Open Legislation portal:

1. Register at **[legislation.nysenate.gov/register](https://legislation.nysenate.gov/register)**
2. You'll receive an API key by email

Bill URLs returned by this server point to the public [nysenate.gov](https://www.nysenate.gov/legislation) website — no login required.

---

## Installation

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
| `get_updates` | Aggregate change feed across all content types for a date range |
| `search` | Full-text search across bills, laws, agendas, calendars, and transcripts |

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

## License

MIT © [BetaNYC](https://beta.nyc)
