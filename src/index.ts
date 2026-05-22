#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { withDisclaimer, currentSessionYear } from "./api.js";
import {
  getBill,
  searchBills,
  listBills,
  getBillVotes,
  getBillUpdates,
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
import { getUpdates } from "./updates.js";
import { search } from "./search.js";

// ─── API key ──────────────────────────────────────────────────────────────────

const apiKey = process.env.NYS_LEGISLATION_API_KEY;
if (!apiKey) {
  console.error(
    "Error: NYS_LEGISLATION_API_KEY environment variable is not set.\n" +
      "Request a free API key at: https://legislation.nysenate.gov/register"
  );
  process.exit(1);
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "nys-openlegislation-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ─── Tool definitions ─────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
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
        "Optionally filter by content type: bills, agendas, calendars, laws.",
      inputSchema: {
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
            description: "Filter by content type: bills, agendas, calendars, laws (optional)",
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
        "Full-text search across all NYS Open Legislation content — bills, resolutions, laws, " +
        "agendas, calendars, and transcripts — using ElasticSearch syntax. " +
        "Supports boolean operators (AND, OR, NOT), phrase quotes, wildcards, and field targeting. " +
        "Use the type filter to restrict results to a single content category.",
      inputSchema: {
        type: "object",
        properties: {
          term: {
            type: "string",
            description: "Search query (e.g. 'minimum wage', 'climate AND emissions', 'title:\"housing\"')",
          },
          type: {
            type: "string",
            description: "Filter by content type: bills, laws, agendas, calendars, transcripts (optional)",
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
  ],
}));

// ─── Tool handlers ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // ── Bills ───────────────────────────────────────────────────────────────
      case "search_bills": {
        const { term, session_year, limit, offset } = z
          .object({
            term: z.string(),
            session_year: z.number().optional(),
            limit: z.number().max(100).optional(),
            offset: z.number().optional(),
          })
          .parse(args);
        const results = await searchBills(
          apiKey,
          term,
          session_year,
          limit ?? 25,
          offset ?? 0
        );
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      case "get_bill": {
        const { print_no, session_year } = z
          .object({ print_no: z.string(), session_year: z.number().optional() })
          .parse(args);
        const result = await getBill(
          apiKey,
          session_year ?? currentSessionYear(),
          print_no
        );
        return { content: [{ type: "text", text: withDisclaimer(result) }] };
      }

      case "list_bills": {
        const { session_year, limit, offset } = z
          .object({
            session_year: z.number().optional(),
            limit: z.number().max(500).optional(),
            offset: z.number().optional(),
          })
          .parse(args ?? {});
        const results = await listBills(
          apiKey,
          session_year ?? currentSessionYear(),
          limit ?? 25,
          offset ?? 0
        );
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      case "get_bill_votes": {
        const { print_no, session_year } = z
          .object({ print_no: z.string(), session_year: z.number().optional() })
          .parse(args);
        const results = await getBillVotes(
          apiKey,
          session_year ?? currentSessionYear(),
          print_no
        );
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      case "get_bill_updates": {
        const { from, to, limit, offset } = z
          .object({
            from: z.string(),
            to: z.string(),
            limit: z.number().max(500).optional(),
            offset: z.number().optional(),
          })
          .parse(args);
        const results = await getBillUpdates(apiKey, from, to, limit ?? 50, offset ?? 0);
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      // ── Laws ────────────────────────────────────────────────────────────────
      case "list_laws": {
        const results = await listLaws(apiKey);
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      case "get_law_tree": {
        const { law_id } = z.object({ law_id: z.string() }).parse(args);
        const result = await getLawTree(apiKey, law_id.toUpperCase());
        return { content: [{ type: "text", text: withDisclaimer(result) }] };
      }

      case "get_law_section": {
        const { law_id, location_id } = z
          .object({ law_id: z.string(), location_id: z.string() })
          .parse(args);
        const result = await getLawSection(apiKey, law_id.toUpperCase(), location_id);
        return { content: [{ type: "text", text: withDisclaimer(result) }] };
      }

      // ── Members ─────────────────────────────────────────────────────────────
      case "list_members": {
        const { chamber, session_year, limit, offset } = z
          .object({
            chamber: z.enum(["senate", "assembly"]),
            session_year: z.number().optional(),
            limit: z.number().optional(),
            offset: z.number().optional(),
          })
          .parse(args);
        const results = await listMembers(
          apiKey,
          session_year ?? currentSessionYear(),
          chamber,
          limit ?? 100,
          offset ?? 0
        );
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      case "get_member": {
        const { member_id, chamber, session_year } = z
          .object({
            member_id: z.number(),
            chamber: z.enum(["senate", "assembly"]),
            session_year: z.number().optional(),
          })
          .parse(args);
        const result = await getMember(
          apiKey,
          session_year ?? currentSessionYear(),
          chamber,
          member_id
        );
        return { content: [{ type: "text", text: withDisclaimer(result) }] };
      }

      case "search_members": {
        const { term, chamber, session_year, limit, offset } = z
          .object({
            term: z.string(),
            chamber: z.enum(["senate", "assembly"]).optional(),
            session_year: z.number().optional(),
            limit: z.number().optional(),
            offset: z.number().optional(),
          })
          .parse(args);
        const results = await searchMembers(
          apiKey,
          term,
          session_year,
          chamber,
          limit ?? 25,
          offset ?? 0
        );
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      // ── Committees ──────────────────────────────────────────────────────────
      case "list_committees": {
        const { chamber, session_year, limit, offset } = z
          .object({
            chamber: z.enum(["senate", "assembly"]),
            session_year: z.number().optional(),
            limit: z.number().optional(),
            offset: z.number().optional(),
          })
          .parse(args);
        const results = await listCommittees(
          apiKey,
          session_year ?? currentSessionYear(),
          chamber,
          limit ?? 100,
          offset ?? 0
        );
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      case "get_committee": {
        const { committee_name, chamber, session_year } = z
          .object({
            committee_name: z.string(),
            chamber: z.enum(["senate", "assembly"]),
            session_year: z.number().optional(),
          })
          .parse(args);
        const result = await getCommittee(
          apiKey,
          session_year ?? currentSessionYear(),
          chamber,
          committee_name
        );
        return { content: [{ type: "text", text: withDisclaimer(result) }] };
      }

      case "get_committee_meetings": {
        const { committee_name, chamber, session_year, limit, offset } = z
          .object({
            committee_name: z.string(),
            chamber: z.enum(["senate", "assembly"]),
            session_year: z.number().optional(),
            limit: z.number().optional(),
            offset: z.number().optional(),
          })
          .parse(args);
        const results = await getCommitteeMeetings(
          apiKey,
          session_year ?? currentSessionYear(),
          chamber,
          committee_name,
          limit ?? 25,
          offset ?? 0
        );
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      // ── Calendars ───────────────────────────────────────────────────────────
      case "list_calendars": {
        const { year, limit, offset } = z
          .object({
            year: z.number().optional(),
            limit: z.number().optional(),
            offset: z.number().optional(),
          })
          .parse(args ?? {});
        const results = await listCalendars(
          apiKey,
          year ?? new Date().getFullYear(),
          limit ?? 50,
          offset ?? 0
        );
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      case "get_calendar": {
        const { year, calendar_no } = z
          .object({ year: z.number(), calendar_no: z.number() })
          .parse(args);
        const result = await getCalendar(apiKey, year, calendar_no);
        return { content: [{ type: "text", text: withDisclaimer(result) }] };
      }

      // ── Agendas ─────────────────────────────────────────────────────────────
      case "list_agendas": {
        const { year, limit, offset } = z
          .object({
            year: z.number().optional(),
            limit: z.number().optional(),
            offset: z.number().optional(),
          })
          .parse(args ?? {});
        const results = await listAgendas(
          apiKey,
          year ?? new Date().getFullYear(),
          limit ?? 50,
          offset ?? 0
        );
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      case "get_agenda": {
        const { year, agenda_no } = z
          .object({ year: z.number(), agenda_no: z.number() })
          .parse(args);
        const result = await getAgenda(apiKey, year, agenda_no);
        return { content: [{ type: "text", text: withDisclaimer(result) }] };
      }

      // ── Transcripts ─────────────────────────────────────────────────────────
      case "list_floor_transcripts": {
        const { year, limit, offset } = z
          .object({
            year: z.number().optional(),
            limit: z.number().optional(),
            offset: z.number().optional(),
          })
          .parse(args ?? {});
        const results = await listFloorTranscripts(
          apiKey,
          year ?? new Date().getFullYear(),
          limit ?? 50,
          offset ?? 0
        );
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      case "get_floor_transcript": {
        const { date_time } = z.object({ date_time: z.string() }).parse(args);
        const result = await getFloorTranscript(apiKey, date_time);
        return { content: [{ type: "text", text: withDisclaimer(result) }] };
      }

      case "list_hearing_transcripts": {
        const { year, limit, offset } = z
          .object({
            year: z.number().optional(),
            limit: z.number().optional(),
            offset: z.number().optional(),
          })
          .parse(args ?? {});
        const results = await listHearingTranscripts(
          apiKey,
          year ?? new Date().getFullYear(),
          limit ?? 50,
          offset ?? 0
        );
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      case "get_hearing_transcript": {
        const { filename } = z.object({ filename: z.string() }).parse(args);
        const result = await getHearingTranscript(apiKey, filename);
        return { content: [{ type: "text", text: withDisclaimer(result) }] };
      }

      // ── Updates ─────────────────────────────────────────────────────────────
      case "get_updates": {
        const { from, to, type, limit, offset } = z
          .object({
            from: z.string(),
            to: z.string(),
            type: z.string().optional(),
            limit: z.number().optional(),
            offset: z.number().optional(),
          })
          .parse(args);
        const results = await getUpdates(
          apiKey,
          from,
          to,
          type,
          limit ?? 50,
          offset ?? 0
        );
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      // ── Search ──────────────────────────────────────────────────────────────
      case "search": {
        const { term, type, session_year, limit, offset } = z
          .object({
            term: z.string(),
            type: z.string().optional(),
            session_year: z.number().optional(),
            limit: z.number().max(100).optional(),
            offset: z.number().optional(),
          })
          .parse(args);
        const results = await search(
          apiKey,
          term,
          type,
          session_year,
          limit ?? 25,
          offset ?? 0
        );
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
