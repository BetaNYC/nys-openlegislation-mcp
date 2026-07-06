#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { withDisclaimer, currentSessionYear } from "./api.js";
import {
  getBill,
  searchBills,
  listBills,
  getBillVotes,
  getBillUpdates,
  getUpdates,
} from "./bills.js";
import { listLaws, getLawTree, getLawSection } from "./laws.js";
import { listMembers, getMember, searchMembers } from "./members.js";
import {
  listCommittees,
  getCommittee,
  getCommitteeMeetings,
} from "./committees.js";
import { listCalendars, getCalendar } from "./calendars.js";
import { listAgendas, getAgenda } from "./agendas.js";
import {
  listFloorTranscripts,
  getFloorTranscript,
  listHearingTranscripts,
  getHearingTranscript,
} from "./transcripts.js";
import { search } from "./search.js";
import {
  localGetBill,
  localSearchBills,
  localListBills,
  localListLaws,
  localGetLawTree,
  localGetLawSection,
  localListMembers,
  localGetMember,
  localListCommittees,
  localGetCommittee,
  localListAgendas,
  localGetAgenda,
  localListCalendars,
  localGetCalendar,
  localListFloorTranscripts,
  localGetFloorTranscript,
  localListHearingTranscripts,
  localGetHearingTranscript,
} from "./db.js";

// ─── API key ──────────────────────────────────────────────────────────────────

const apiKey = process.env.NYS_LEGISLATION_API_KEY;
if (!apiKey) {
  console.error(
    "Error: NYS_LEGISLATION_API_KEY environment variable is not set.\n" +
      "Request a free API key at: https://legislation.nysenate.gov/register"
  );
  process.exit(1);
}
const key = apiKey; // narrowed to string for closures below

// ─── Shared schema fragments ──────────────────────────────────────────────────

const sessionYear = z
  .number()
  .optional()
  .describe("Session year (odd-numbered, e.g. 2025). Defaults to current session.");
const chamber = z
  .enum(["senate", "assembly"])
  .describe("Which chamber the member belongs to");
const limit = (dflt: number, max?: number) => {
  const base = max ? z.number().max(max) : z.number();
  return base
    .optional()
    .describe(`Max results (default ${dflt}${max ? `, max ${max}` : ""})`);
};
const offset = z.number().optional().describe("Pagination offset (default 0)");
const calYear = z
  .number()
  .optional()
  .describe("Calendar year (e.g. 2025). Defaults to current year.");

// ─── Tool table ───────────────────────────────────────────────────────────────
//
// Each row declares a tool once: name, description, zod input schema, an
// optional local-corpus function, and the live-API function. The dispatcher
// tries `local` first (any non-null result wins) and falls back to `live`.

type ToolRow = {
  name: string;
  description: string;
  schema: Record<string, z.ZodTypeAny>;
  local?: (args: Record<string, any>) => Promise<unknown | null>;
  live: (args: Record<string, any>) => Promise<unknown>;
};

const session = (a: Record<string, any>) => a.session_year ?? currentSessionYear();
const year = (a: Record<string, any>) => a.year ?? new Date().getFullYear();

const TOOLS: ToolRow[] = [
  // ── Bills ───────────────────────────────────────────────────────────────────
  {
    name: "search_bills",
    description:
      "Search NYS legislation by keyword using ElasticSearch syntax. " +
      "Searches bill titles, summaries, and full text. Supports boolean operators " +
      "(AND, OR, NOT), phrase quotes, wildcards, and field targeting " +
      "(e.g. title:\"climate\" AND sponsor:Krueger). " +
      "Optionally filter by session year (odd-numbered years: 2023, 2025, etc.).",
    schema: {
      term: z.string().describe("Search term or ElasticSearch query string"),
      session_year: z
        .number()
        .optional()
        .describe("Legislative session year (odd-numbered, e.g. 2025). Defaults to current session."),
      limit: limit(25, 100),
      offset,
    },
    local: (a) => localSearchBills(a.term, a.session_year, a.limit ?? 25, a.offset ?? 0),
    live: (a) => searchBills(key, a.term, a.session_year, a.limit ?? 25, a.offset ?? 0),
  },
  {
    name: "get_bill",
    description:
      "Get a specific NYS bill by print number and session year. " +
      "Print numbers are in the format S1234 (Senate) or A1234 (Assembly). " +
      "Returns full bill details including status, sponsor, summary, actions, and votes.",
    schema: {
      print_no: z.string().describe("Bill print number, e.g. 'S1234' or 'A5678'"),
      session_year: sessionYear,
    },
    local: (a) => localGetBill(session(a), a.print_no),
    live: (a) => getBill(key, session(a), a.print_no),
  },
  {
    name: "list_bills",
    description:
      "List bills introduced in a given NYS legislative session year, in order of introduction.",
    schema: {
      session_year: sessionYear,
      limit: limit(25, 500),
      offset,
    },
    local: (a) => localListBills(session(a), a.limit ?? 25, a.offset ?? 0),
    live: (a) => listBills(key, session(a), a.limit ?? 25, a.offset ?? 0),
  },
  {
    name: "get_bill_votes",
    description:
      "Get all recorded votes on a specific NYS bill, including committee and floor votes. " +
      "Returns each member's vote (Aye, Nay, Abstain, Absent, etc.).",
    schema: {
      print_no: z.string().describe("Bill print number, e.g. 'S1234'"),
      session_year: sessionYear,
    },
    // Votes always fetched live — they change frequently
    live: (a) => getBillVotes(key, session(a), a.print_no),
  },
  {
    name: "get_bill_updates",
    description:
      "Get a feed of bill changes within a date range — useful for tracking what was introduced, " +
      "amended, or acted on during a specific period.",
    schema: {
      from: z
        .string()
        .describe("Start datetime, ISO-8601 format: 'YYYY-MM-DDTHH:MM:SS' (e.g. '2025-01-01T00:00:00')"),
      to: z.string().describe("End datetime, ISO-8601 format: 'YYYY-MM-DDTHH:MM:SS'"),
      limit: limit(50, 500),
      offset,
    },
    // Updates always fetched live by design
    live: (a) => getBillUpdates(key, a.from, a.to, a.limit ?? 50, a.offset ?? 0),
  },

  // ── Laws ────────────────────────────────────────────────────────────────────
  {
    name: "list_laws",
    description:
      "List all law bodies in New York State — the Consolidated Laws, the NYC Administrative Code, " +
      "the state Constitution, and other codified bodies. Returns law IDs and names.",
    schema: {},
    local: async () => {
      const local = await localListLaws();
      return local ? { items: local, size: local.length } : null;
    },
    live: () => listLaws(key),
  },
  {
    name: "get_law_tree",
    description:
      "Get the hierarchical table of contents for a specific NYS law body. " +
      "Use list_laws to find the law ID (e.g. 'EDN' for Education Law, 'LAB' for Labor Law). " +
      "Returns the document tree with titles and location IDs for each section.",
    schema: {
      law_id: z
        .string()
        .describe("Law body identifier, e.g. 'EDN' (Education), 'LAB' (Labor), 'ENV' (Environmental). Use list_laws to find IDs."),
    },
    local: (a) => localGetLawTree(a.law_id),
    live: (a) => getLawTree(key, a.law_id.toUpperCase()),
  },
  {
    name: "get_law_section",
    description:
      "Get the text of a specific section within an NYS law body. " +
      "Use get_law_tree to find the location ID for the section you need.",
    schema: {
      law_id: z.string().describe("Law body identifier, e.g. 'EDN'"),
      location_id: z
        .string()
        .describe("Section location ID from the law tree, e.g. 'A1S1' or '701'"),
    },
    local: (a) => localGetLawSection(a.law_id, a.location_id),
    live: (a) => getLawSection(key, a.law_id.toUpperCase(), a.location_id),
  },

  // ── Members ─────────────────────────────────────────────────────────────────
  {
    name: "list_members",
    description:
      "List all members of the NYS Senate or Assembly for a given session year. " +
      "Returns member IDs, names, districts, and contact information.",
    schema: {
      chamber: z
        .enum(["senate", "assembly"])
        .describe("Which chamber to list (senate or assembly)"),
      session_year: sessionYear,
      limit: limit(100),
      offset,
    },
    local: (a) => localListMembers(session(a), a.chamber, a.limit ?? 100, a.offset ?? 0),
    live: (a) => listMembers(key, session(a), a.chamber, a.limit ?? 100, a.offset ?? 0),
  },
  {
    name: "get_member",
    description:
      "Get a specific NYS legislator by their member ID. " +
      "Returns full profile including name, district, contact info, and party.",
    schema: {
      member_id: z
        .number()
        .describe("Numeric member ID (from list_members or search_members)"),
      chamber,
      session_year: sessionYear,
    },
    local: (a) => localGetMember(session(a), a.chamber, a.member_id),
    live: (a) => getMember(key, session(a), a.chamber, a.member_id),
  },
  {
    name: "search_members",
    description:
      "Search for NYS legislators by name or keyword. " +
      "Optionally filter by chamber or session year.",
    schema: {
      term: z.string().describe("Name or keyword to search"),
      chamber: z
        .enum(["senate", "assembly"])
        .optional()
        .describe("Filter by chamber (optional)"),
      session_year: sessionYear,
      limit: limit(25),
      offset,
    },
    // Member search always hits API (no local FTS for members)
    live: (a) => searchMembers(key, a.term, a.session_year, a.chamber, a.limit ?? 25, a.offset ?? 0),
  },

  // ── Committees ──────────────────────────────────────────────────────────────
  {
    name: "list_committees",
    description:
      "List all committees in the NYS Senate or Assembly for a given session year.",
    schema: {
      chamber: z
        .enum(["senate", "assembly"])
        .describe("Which chamber's committees to list"),
      session_year: sessionYear,
      limit: limit(100),
      offset,
    },
    local: (a) => localListCommittees(session(a), a.chamber, a.limit ?? 100, a.offset ?? 0),
    live: (a) => listCommittees(key, session(a), a.chamber, a.limit ?? 100, a.offset ?? 0),
  },
  {
    name: "get_committee",
    description:
      "Get details for a specific NYS committee — chair, meeting schedule, location, and subcommittees.",
    schema: {
      committee_name: z
        .string()
        .describe("Full committee name, e.g. 'Finance', 'Codes', 'Health'"),
      chamber: z
        .enum(["senate", "assembly"])
        .describe("Which chamber the committee belongs to"),
      session_year: sessionYear,
    },
    local: (a) => localGetCommittee(session(a), a.chamber, a.committee_name),
    live: (a) => getCommittee(key, session(a), a.chamber, a.committee_name),
  },
  {
    name: "get_committee_meetings",
    description:
      "Get the meeting history and upcoming meetings for a specific NYS committee, " +
      "including bills considered at each meeting.",
    schema: {
      committee_name: z.string().describe("Full committee name, e.g. 'Finance'"),
      chamber: z
        .enum(["senate", "assembly"])
        .describe("Which chamber the committee belongs to"),
      session_year: sessionYear,
      limit: limit(25),
      offset,
    },
    // Meeting history is always fetched live — schedule changes frequently
    live: (a) =>
      getCommitteeMeetings(key, session(a), a.chamber, a.committee_name, a.limit ?? 25, a.offset ?? 0),
  },

  // ── Calendars ───────────────────────────────────────────────────────────────
  {
    name: "list_calendars",
    description:
      "List Senate floor calendars for a given year. " +
      "Floor calendars show which bills are scheduled for floor votes.",
    schema: { year: calYear, limit: limit(50), offset },
    local: (a) => localListCalendars(year(a), a.limit ?? 50, a.offset ?? 0),
    live: (a) => listCalendars(key, year(a), a.limit ?? 50, a.offset ?? 0),
  },
  {
    name: "get_calendar",
    description:
      "Get a specific Senate floor calendar by year and calendar number. " +
      "Returns active lists and supplemental calendars showing bills scheduled for floor votes.",
    schema: {
      year: z.number().describe("Calendar year (e.g. 2025)"),
      calendar_no: z.number().describe("Calendar number within the year"),
    },
    local: (a) => localGetCalendar(a.year, a.calendar_no),
    live: (a) => getCalendar(key, a.year, a.calendar_no),
  },

  // ── Agendas ─────────────────────────────────────────────────────────────────
  {
    name: "list_agendas",
    description:
      "List committee agendas for a given year. " +
      "Agendas show committee meeting schedules and which bills were considered.",
    schema: { year: calYear, limit: limit(50), offset },
    local: (a) => localListAgendas(year(a), a.limit ?? 50, a.offset ?? 0),
    live: (a) => listAgendas(key, year(a), a.limit ?? 50, a.offset ?? 0),
  },
  {
    name: "get_agenda",
    description:
      "Get a specific committee agenda by year and agenda number. " +
      "Returns committee meetings, bills considered, and vote records.",
    schema: {
      year: z.number().describe("Calendar year (e.g. 2025)"),
      agenda_no: z.number().describe("Agenda number within the year"),
    },
    local: (a) => localGetAgenda(a.year, a.agenda_no),
    live: (a) => getAgenda(key, a.year, a.agenda_no),
  },

  // ── Transcripts ─────────────────────────────────────────────────────────────
  {
    name: "list_floor_transcripts",
    description: "List NYS Senate floor session transcripts for a given year.",
    schema: {
      year: z
        .number()
        .optional()
        .describe("Year of the transcripts (e.g. 2025). Defaults to current year."),
      limit: limit(50),
      offset,
    },
    local: (a) => localListFloorTranscripts(year(a), a.limit ?? 50, a.offset ?? 0),
    live: (a) => listFloorTranscripts(key, year(a), a.limit ?? 50, a.offset ?? 0),
  },
  {
    name: "get_floor_transcript",
    description:
      "Get a specific NYS Senate floor session transcript by its datetime. " +
      "Use list_floor_transcripts to find datetime values.",
    schema: {
      date_time: z
        .string()
        .describe("Session datetime, ISO-8601 format: 'YYYY-MM-DDTHH:MM:SS'"),
    },
    // Local returns null if text wasn't fetched (--include-transcript-text not used)
    local: (a) => localGetFloorTranscript(a.date_time),
    live: (a) => getFloorTranscript(key, a.date_time),
  },
  {
    name: "list_hearing_transcripts",
    description: "List NYS Senate public hearing transcripts for a given year.",
    schema: {
      year: z
        .number()
        .optional()
        .describe("Year of the transcripts (e.g. 2025). Defaults to current year."),
      limit: limit(50),
      offset,
    },
    local: (a) => localListHearingTranscripts(year(a), a.limit ?? 50, a.offset ?? 0),
    live: (a) => listHearingTranscripts(key, year(a), a.limit ?? 50, a.offset ?? 0),
  },
  {
    name: "get_hearing_transcript",
    description:
      "Get a specific NYS Senate public hearing transcript by its filename. " +
      "Use list_hearing_transcripts to find filenames.",
    schema: {
      filename: z
        .string()
        .describe("Hearing transcript filename (from list_hearing_transcripts)"),
    },
    // Local returns null if text wasn't fetched (--include-transcript-text not used)
    local: (a) => localGetHearingTranscript(a.filename),
    live: (a) => getHearingTranscript(key, a.filename),
  },

  // ── Updates ─────────────────────────────────────────────────────────────────
  {
    name: "get_updates",
    description:
      "Get aggregate updates across all NYS Open Legislation content types for a date range. " +
      "Useful for polling what changed — new bills, amendments, votes, agendas, etc. " +
      "Optionally filter by content type: bills, agendas, calendars, laws.",
    schema: {
      from: z.string().describe("Start datetime, ISO-8601: 'YYYY-MM-DDTHH:MM:SS'"),
      to: z.string().describe("End datetime, ISO-8601: 'YYYY-MM-DDTHH:MM:SS'"),
      type: z
        .string()
        .optional()
        .describe("Filter by content type: bills, agendas, calendars, laws (optional)"),
      limit: limit(50),
      offset,
    },
    live: (a) => getUpdates(key, a.from, a.to, a.type, a.limit ?? 50, a.offset ?? 0),
  },

  // ── Search ──────────────────────────────────────────────────────────────────
  {
    name: "search",
    description:
      "Full-text search within one NYS Open Legislation content type using ElasticSearch syntax. " +
      "The upstream API has no unified search endpoint — each content type is searched separately, " +
      "so this tool searches a single type per call (defaults to bills). " +
      "Supported types: bills, laws, agendas, calendars, transcripts, hearings. " +
      "Supports boolean operators (AND, OR, NOT), phrase quotes, wildcards, and field targeting. " +
      "To search resolutions, use type 'bills' (they share the bills index).",
    schema: {
      term: z
        .string()
        .describe("Search query (e.g. 'minimum wage', 'climate AND emissions', 'title:\"housing\"')"),
      type: z
        .enum(["bills", "laws", "agendas", "calendars", "transcripts", "hearings"])
        .optional()
        .describe(
          "Content type to search: bills (default), laws, agendas, calendars, transcripts, hearings. " +
            "One type per call."
        ),
      session_year: z
        .number()
        .optional()
        .describe("Filter bills to a specific session year (optional)"),
      limit: limit(25, 100),
      offset,
    },
    live: (a) => search(key, a.term, a.type, a.session_year, a.limit ?? 25, a.offset ?? 0),
  },
];

// ─── Server + generic dispatcher ──────────────────────────────────────────────

const server = new McpServer(
  { name: "nys-openlegislation-mcp", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

for (const tool of TOOLS) {
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.schema },
    async (args: Record<string, any>) => {
      try {
        const local = tool.local ? await tool.local(args ?? {}) : null;
        const result = local ?? (await tool.live(args ?? {}));
        return { content: [{ type: "text" as const, text: withDisclaimer(result) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

// ─── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
