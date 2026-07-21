/**
 * Tool contract for nys-openlegislation-mcp.
 *
 * Every `inputSchema` sets `additionalProperties: false`, which tells the
 * calling model up front that an invented parameter is invalid. `parseArgs`
 * enforces the same contract server-side for anything that slips through.
 *
 * Before this, unknown parameters were silently dropped (zod's default) and the
 * server returned real, correctly-sourced data answering a *different* question,
 * with nothing in the response to signal the dropped filter. See issue #11.
 */
import { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const TOOLS: Tool[] = [
  // ── Bills ─────────────────────────────────────────────────────────────────
  {
    name: "search_bills",
    description:
      "Search NYS legislation by keyword using ElasticSearch syntax. " +
      "Searches bill titles, summaries, and full text. Supports boolean operators " +
      "(AND, OR, NOT), phrase quotes, wildcards, and field targeting " +
      "(e.g. title:\"climate\" AND sponsor:Krueger). " +
      "Optionally filter by session year (odd-numbered years: 2023, 2025, etc.).",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        term: { type: "string", description: "Search term or ElasticSearch query string" },
        session_year: {
          type: "number",
          description: "Legislative session year (odd-numbered, e.g. 2025). Defaults to current session.",
        },
        limit: { type: "number", description: "Max results (default 25, max 100)" },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
      required: ["term"],
    },
  },
  {
    name: "get_bill",
    description:
      "Get a specific NYS bill by print number and session year. " +
      "Print numbers are in the format S1234 (Senate) or A1234 (Assembly). " +
      "Returns full bill details including status, sponsor, summary, actions, and votes.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        print_no: {
          type: "string",
          description: "Bill print number, e.g. 'S1234' or 'A5678'",
        },
        session_year: {
          type: "number",
          description: "Session year (odd-numbered, e.g. 2025). Defaults to current session.",
        },
      },
      required: ["print_no"],
    },
  },
  {
    name: "list_bills",
    description:
      "List bills introduced in a given NYS legislative session year, in order of introduction.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        session_year: {
          type: "number",
          description: "Session year (odd-numbered, e.g. 2025). Defaults to current session.",
        },
        limit: { type: "number", description: "Max results (default 25, max 500)" },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
    },
  },
  {
    name: "get_bill_votes",
    description:
      "Get all recorded votes on a specific NYS bill, including committee and floor votes. " +
      "Returns each member's vote (Aye, Nay, Abstain, Absent, etc.).",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        print_no: {
          type: "string",
          description: "Bill print number, e.g. 'S1234'",
        },
        session_year: {
          type: "number",
          description: "Session year (odd-numbered, e.g. 2025). Defaults to current session.",
        },
      },
      required: ["print_no"],
    },
  },
  {
    name: "get_bill_updates",
    description:
      "Get a feed of bill changes within a date range — useful for tracking what was introduced, " +
      "amended, or acted on during a specific period.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "Start datetime, ISO-8601 format: 'YYYY-MM-DDTHH:MM:SS' (e.g. '2025-01-01T00:00:00')",
        },
        to: {
          type: "string",
          description: "End datetime, ISO-8601 format: 'YYYY-MM-DDTHH:MM:SS'",
        },
        limit: { type: "number", description: "Max results (default 50, max 500)" },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
      required: ["from", "to"],
    },
  },

  // ── Laws ──────────────────────────────────────────────────────────────────
  {
    name: "list_laws",
    description:
      "List all law bodies in New York State — the Consolidated Laws, the NYC Administrative Code, " +
      "the state Constitution, and other codified bodies. Returns law IDs and names.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_law_tree",
    description:
      "Get the hierarchical table of contents for a specific NYS law body. " +
      "Use list_laws to find the law ID (e.g. 'EDN' for Education Law, 'LAB' for Labor Law). " +
      "Returns the document tree with titles and location IDs for each section.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        law_id: {
          type: "string",
          description: "Law body identifier, e.g. 'EDN' (Education), 'LAB' (Labor), 'ENV' (Environmental). Use list_laws to find IDs.",
        },
      },
      required: ["law_id"],
    },
  },
  {
    name: "get_law_section",
    description:
      "Get the text of a specific section within an NYS law body. " +
      "Use get_law_tree to find the location ID for the section you need.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        law_id: {
          type: "string",
          description: "Law body identifier, e.g. 'EDN'",
        },
        location_id: {
          type: "string",
          description: "Section location ID from the law tree, e.g. 'A1S1' or '701'",
        },
      },
      required: ["law_id", "location_id"],
    },
  },

  // ── Members ───────────────────────────────────────────────────────────────
  {
    name: "list_members",
    description:
      "List all members of the NYS Senate or Assembly for a given session year. " +
      "Returns member IDs, names, districts, and contact information.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        chamber: {
          type: "string",
          enum: ["senate", "assembly"],
          description: "Which chamber to list (senate or assembly)",
        },
        session_year: {
          type: "number",
          description: "Session year (odd-numbered, e.g. 2025). Defaults to current session.",
        },
        limit: { type: "number", description: "Max results (default 100)" },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
      required: ["chamber"],
    },
  },
  {
    name: "get_member",
    description:
      "Get a specific NYS legislator by their member ID. " +
      "Returns full profile including name, district, contact info, and party.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        member_id: {
          type: "number",
          description: "Numeric member ID (from list_members or search_members)",
        },
        chamber: {
          type: "string",
          enum: ["senate", "assembly"],
          description: "Which chamber the member belongs to",
        },
        session_year: {
          type: "number",
          description: "Session year (odd-numbered, e.g. 2025). Defaults to current session.",
        },
      },
      required: ["member_id", "chamber"],
    },
  },
  {
    name: "search_members",
    description:
      "Search for NYS legislators by name or keyword. " +
      "Optionally filter by chamber or session year.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        term: { type: "string", description: "Name or keyword to search" },
        chamber: {
          type: "string",
          enum: ["senate", "assembly"],
          description: "Filter by chamber (optional)",
        },
        session_year: {
          type: "number",
          description: "Session year (odd-numbered, e.g. 2025). Defaults to current session.",
        },
        limit: { type: "number", description: "Max results (default 25)" },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
      required: ["term"],
    },
  },

  // ── Committees ────────────────────────────────────────────────────────────
  {
    name: "list_committees",
    description:
      "List all committees in the NYS Senate or Assembly for a given session year.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        chamber: {
          type: "string",
          enum: ["senate", "assembly"],
          description: "Which chamber's committees to list",
        },
        session_year: {
          type: "number",
          description: "Session year (odd-numbered, e.g. 2025). Defaults to current session.",
        },
        limit: { type: "number", description: "Max results (default 100)" },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
      required: ["chamber"],
    },
  },
  {
    name: "get_committee",
    description:
      "Get details for a specific NYS committee — chair, meeting schedule, location, and subcommittees.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        committee_name: {
          type: "string",
          description: "Full committee name, e.g. 'Finance', 'Codes', 'Health'",
        },
        chamber: {
          type: "string",
          enum: ["senate", "assembly"],
          description: "Which chamber the committee belongs to",
        },
        session_year: {
          type: "number",
          description: "Session year (odd-numbered, e.g. 2025). Defaults to current session.",
        },
      },
      required: ["committee_name", "chamber"],
    },
  },
  {
    name: "get_committee_meetings",
    description:
      "Get the meeting history and upcoming meetings for a specific NYS committee, " +
      "including bills considered at each meeting.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        committee_name: {
          type: "string",
          description: "Full committee name, e.g. 'Finance'",
        },
        chamber: {
          type: "string",
          enum: ["senate", "assembly"],
          description: "Which chamber the committee belongs to",
        },
        session_year: {
          type: "number",
          description: "Session year (odd-numbered, e.g. 2025). Defaults to current session.",
        },
        limit: { type: "number", description: "Max results (default 25)" },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
      required: ["committee_name", "chamber"],
    },
  },

  // ── Calendars ─────────────────────────────────────────────────────────────
  {
    name: "list_calendars",
    description:
      "List Senate floor calendars for a given year. " +
      "Floor calendars show which bills are scheduled for floor votes.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        year: {
          type: "number",
          description: "Calendar year (e.g. 2025). Defaults to current year.",
        },
        limit: { type: "number", description: "Max results (default 50)" },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
    },
  },
  {
    name: "get_calendar",
    description:
      "Get a specific Senate floor calendar by year and calendar number. " +
      "Returns active lists and supplemental calendars showing bills scheduled for floor votes.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        year: {
          type: "number",
          description: "Calendar year (e.g. 2025)",
        },
        calendar_no: {
          type: "number",
          description: "Calendar number within the year",
        },
      },
      required: ["year", "calendar_no"],
    },
  },

  // ── Agendas ───────────────────────────────────────────────────────────────
  {
    name: "list_agendas",
    description:
      "List committee agendas for a given year. " +
      "Agendas show committee meeting schedules and which bills were considered.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        year: {
          type: "number",
          description: "Calendar year (e.g. 2025). Defaults to current year.",
        },
        limit: { type: "number", description: "Max results (default 50)" },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
    },
  },
  {
    name: "get_agenda",
    description:
      "Get a specific committee agenda by year and agenda number. " +
      "Returns committee meetings, bills considered, and vote records.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        year: {
          type: "number",
          description: "Calendar year (e.g. 2025)",
        },
        agenda_no: {
          type: "number",
          description: "Agenda number within the year",
        },
      },
      required: ["year", "agenda_no"],
    },
  },

  // ── Transcripts ───────────────────────────────────────────────────────────
  {
    name: "list_floor_transcripts",
    description:
      "List NYS Senate floor session transcripts for a given year.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        year: {
          type: "number",
          description: "Year of the transcripts (e.g. 2025). Defaults to current year.",
        },
        limit: { type: "number", description: "Max results (default 50)" },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
    },
  },
  {
    name: "get_floor_transcript",
    description:
      "Get a specific NYS Senate floor session transcript by its datetime. " +
      "Use list_floor_transcripts to find datetime values.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        date_time: {
          type: "string",
          description: "Session datetime, ISO-8601 format: 'YYYY-MM-DDTHH:MM:SS'",
        },
      },
      required: ["date_time"],
    },
  },
  {
    name: "list_hearing_transcripts",
    description:
      "List NYS Senate public hearing transcripts for a given year.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        year: {
          type: "number",
          description: "Year of the transcripts (e.g. 2025). Defaults to current year.",
        },
        limit: { type: "number", description: "Max results (default 50)" },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
    },
  },
  {
    name: "get_hearing_transcript",
    description:
      "Get a specific NYS Senate public hearing transcript by its filename. " +
      "Use list_hearing_transcripts to find filenames.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        filename: {
          type: "string",
          description: "Hearing transcript filename (from list_hearing_transcripts)",
        },
      },
      required: ["filename"],
    },
  },

  // ── Updates ───────────────────────────────────────────────────────────────
  {
    name: "get_updates",
    description:
      "Get aggregate updates across all NYS Open Legislation content types for a date range. " +
      "Useful for polling what changed — new bills, amendments, votes, agendas, etc. " +
      "Optionally restrict to one content type via content_type: bills, agendas, calendars, laws.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "Start datetime, ISO-8601: 'YYYY-MM-DDTHH:MM:SS'",
        },
        to: {
          type: "string",
          description: "End datetime, ISO-8601: 'YYYY-MM-DDTHH:MM:SS'",
        },
        type: {
          type: "string",
          enum: ["processed", "published"],
          description:
            "Which timestamp the date range filters on: 'processed' (when Open Legislation " +
            "processed the change) or 'published' (when the source data was published). " +
            "Not a content-type filter — use content_type for that. (optional)",
        },
        content_type: {
          type: "string",
          enum: ["bills", "agendas", "calendars", "laws"],
          description: "Restrict results to one content type (optional)",
        },
        limit: { type: "number", description: "Max results (default 50)" },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
      required: ["from", "to"],
    },
  },

  // ── Search ────────────────────────────────────────────────────────────────
  {
    name: "search",
    description:
      "Full-text search within one NYS Open Legislation content type using ElasticSearch syntax. " +
      "The upstream API has no unified search endpoint — each content type is searched separately, " +
      "so this tool searches a single type per call (defaults to bills). " +
      "Supported types: bills, laws, agendas, calendars, transcripts, hearings. " +
      "Supports boolean operators (AND, OR, NOT), phrase quotes, wildcards, and field targeting. " +
      "To search resolutions, use type 'bills' (they share the bills index).",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        term: {
          type: "string",
          description: "Search query (e.g. 'minimum wage', 'climate AND emissions', 'title:\"housing\"')",
        },
        type: {
          type: "string",
          description:
            "Content type to search: bills (default), laws, agendas, calendars, transcripts, hearings. " +
            "One type per call.",
          enum: ["bills", "laws", "agendas", "calendars", "transcripts", "hearings"],
        },
        session_year: {
          type: "number",
          description: "Filter bills to a specific session year (optional)",
        },
        limit: { type: "number", description: "Max results (default 25, max 100)" },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
      required: ["term"],
    },
  },
];

/**
 * Parse tool arguments against a strict schema.
 *
 * On an unrecognized key, names the offending parameter *and* the ones this
 * specific tool does accept, so the caller can correct the call rather than
 * guess again. (House style borrowed from nyc-checkbook-mcp's
 * `VENDOR_NAME_UNSUPPORTED_MESSAGE`: name the limitation, then the alternatives.)
 */
export function parseArgs<T extends z.ZodRawShape>(
  toolName: string,
  shape: T,
  args: unknown
): z.output<z.ZodObject<T>> {
  const parsed = z.object(shape).strict().safeParse(args ?? {});
  if (parsed.success) return parsed.data;
  const unknownKeys = parsed.error.issues.flatMap((issue) =>
    issue.code === "unrecognized_keys" ? issue.keys : []
  );
  if (unknownKeys.length === 0) throw parsed.error;
  const accepted = Object.keys(shape);
  throw new Error(
    `${toolName} does not accept ${unknownKeys.map((k) => `'${k}'`).join(", ")}. ` +
      "Unrecognized parameters are rejected rather than ignored, because silently " +
      "dropping a filter returns real data that answers a different question. " +
      (accepted.length
        ? `${toolName} accepts: ${accepted.join(", ")}.`
        : `${toolName} accepts no parameters.`)
  );
}
