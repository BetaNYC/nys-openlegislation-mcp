/**
 * Tool dispatch for nys-openlegislation-mcp.
 *
 * Split out of index.ts so tests can call tools directly without starting a
 * stdio server. Every argument parse goes through `parseArgs`, which is strict:
 * an unknown parameter raises instead of being silently dropped (issue #11).
 */
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { withDisclaimer, currentSessionYear } from "./api.js";
import { parseArgs } from "./tools.js";
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
import { isEmptyLocalResult, annotateLocalResult } from "./localResult.js";
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

/**
 * Wrap a local corpus result into a tool response, or return null to fall
 * through to the live API. Empty local results (0 items) never shadow live
 * data; served results carry a `source: "local corpus (synced <date>)"` note.
 */
async function localResponse(
  local: unknown
): Promise<CallToolResult | null> {
  if (local == null || isEmptyLocalResult(local)) return null;
  const annotated = await annotateLocalResult(local as object);
  return { content: [{ type: "text", text: withDisclaimer(annotated) }] };
}

export async function callTool(
  apiKey: string,
  name: string,
  args: unknown
): Promise<CallToolResult> {
  try {
    switch (name) {
      // ── Bills ───────────────────────────────────────────────────────────────
      case "search_bills": {
        const { term, session_year, limit, offset } = parseArgs(name, {
          term: z.string(),
          session_year: z.number().optional(),
          limit: z.number().max(100).optional(),
          offset: z.number().optional(),
        }, args);
        const local = await localSearchBills(term, session_year, limit ?? 25, offset ?? 0);
        const localResp = await localResponse(local);
        if (localResp) return localResp;
        const results = await searchBills(apiKey, term, session_year, limit ?? 25, offset ?? 0);
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      case "get_bill": {
        const { print_no, session_year } = parseArgs(name, { print_no: z.string(), session_year: z.number().optional() }, args);
        const year = session_year ?? currentSessionYear();
        const local = await localGetBill(year, print_no);
        const localResp = await localResponse(local);
        if (localResp) return localResp;
        const result = await getBill(apiKey, year, print_no);
        return { content: [{ type: "text", text: withDisclaimer(result) }] };
      }

      case "list_bills": {
        const { session_year, limit, offset } = parseArgs(name, {
          session_year: z.number().optional(),
          limit: z.number().max(500).optional(),
          offset: z.number().optional(),
        }, args);
        const year = session_year ?? currentSessionYear();
        const local = await localListBills(year, limit ?? 25, offset ?? 0);
        const localResp = await localResponse(local);
        if (localResp) return localResp;
        const results = await listBills(apiKey, year, limit ?? 25, offset ?? 0);
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      case "get_bill_votes": {
        const { print_no, session_year } = parseArgs(name, { print_no: z.string(), session_year: z.number().optional() }, args);
        // Votes always fetched live — they change frequently
        const results = await getBillVotes(apiKey, session_year ?? currentSessionYear(), print_no);
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      case "get_bill_updates": {
        const { from, to, limit, offset } = parseArgs(name, {
          from: z.string(),
          to: z.string(),
          limit: z.number().max(500).optional(),
          offset: z.number().optional(),
        }, args);
        // Updates always fetched live by design
        const results = await getBillUpdates(apiKey, from, to, limit ?? 50, offset ?? 0);
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      // ── Laws ────────────────────────────────────────────────────────────────
      case "list_laws": {
        // Takes no parameters, but still parsed: an unknown key must be
        // rejected rather than ignored (issue #11).
        parseArgs(name, {}, args);
        const local = await localListLaws();
        const localResp = await localResponse(local ? { items: local, size: local.length } : null);
        if (localResp) return localResp;
        const results = await listLaws(apiKey);
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      case "get_law_tree": {
        const { law_id } = parseArgs(name, { law_id: z.string() }, args);
        const local = await localGetLawTree(law_id);
        const localResp = await localResponse(local);
        if (localResp) return localResp;
        const result = await getLawTree(apiKey, law_id.toUpperCase());
        return { content: [{ type: "text", text: withDisclaimer(result) }] };
      }

      case "get_law_section": {
        const { law_id, location_id } = parseArgs(name, { law_id: z.string(), location_id: z.string() }, args);
        const local = await localGetLawSection(law_id, location_id);
        const localResp = await localResponse(local);
        if (localResp) return localResp;
        const result = await getLawSection(apiKey, law_id.toUpperCase(), location_id);
        return { content: [{ type: "text", text: withDisclaimer(result) }] };
      }

      // ── Members ─────────────────────────────────────────────────────────────
      case "list_members": {
        const { chamber, session_year, limit, offset } = parseArgs(name, {
          chamber: z.enum(["senate", "assembly"]),
          session_year: z.number().optional(),
          limit: z.number().optional(),
          offset: z.number().optional(),
        }, args);
        const year = session_year ?? currentSessionYear();
        const local = await localListMembers(year, chamber, limit ?? 100, offset ?? 0);
        const localResp = await localResponse(local);
        if (localResp) return localResp;
        const results = await listMembers(apiKey, year, chamber, limit ?? 100, offset ?? 0);
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      case "get_member": {
        const { member_id, chamber, session_year } = parseArgs(name, {
          member_id: z.number(),
          chamber: z.enum(["senate", "assembly"]),
          session_year: z.number().optional(),
        }, args);
        const year = session_year ?? currentSessionYear();
        const local = await localGetMember(year, chamber, member_id);
        const localResp = await localResponse(local);
        if (localResp) return localResp;
        const result = await getMember(apiKey, year, member_id);
        return { content: [{ type: "text", text: withDisclaimer(result) }] };
      }

      case "search_members": {
        const { term, chamber, session_year, limit, offset } = parseArgs(name, {
          term: z.string(),
          chamber: z.enum(["senate", "assembly"]).optional(),
          session_year: z.number().optional(),
          limit: z.number().optional(),
          offset: z.number().optional(),
        }, args);
        // Member search always hits API (no local FTS for members)
        const results = await searchMembers(apiKey, term, session_year, chamber, limit ?? 25, offset ?? 0);
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      // ── Committees ──────────────────────────────────────────────────────────
      case "list_committees": {
        const { chamber, session_year, limit, offset } = parseArgs(name, {
          chamber: z.enum(["senate", "assembly"]),
          session_year: z.number().optional(),
          limit: z.number().optional(),
          offset: z.number().optional(),
        }, args);
        const year = session_year ?? currentSessionYear();
        const local = await localListCommittees(year, chamber, limit ?? 100, offset ?? 0);
        const localResp = await localResponse(local);
        if (localResp) return localResp;
        const results = await listCommittees(apiKey, year, chamber, limit ?? 100, offset ?? 0);
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      case "get_committee": {
        const { committee_name, chamber, session_year } = parseArgs(name, {
          committee_name: z.string(),
          chamber: z.enum(["senate", "assembly"]),
          session_year: z.number().optional(),
        }, args);
        const year = session_year ?? currentSessionYear();
        const local = await localGetCommittee(year, chamber, committee_name);
        const localResp = await localResponse(local);
        if (localResp) return localResp;
        const result = await getCommittee(apiKey, year, chamber, committee_name);
        return { content: [{ type: "text", text: withDisclaimer(result) }] };
      }

      case "get_committee_meetings": {
        const { committee_name, chamber, session_year, limit, offset } = parseArgs(name, {
          committee_name: z.string(),
          chamber: z.enum(["senate", "assembly"]),
          session_year: z.number().optional(),
          limit: z.number().optional(),
          offset: z.number().optional(),
        }, args);
        // Meeting history is always fetched live — schedule changes frequently
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
        const { year, limit, offset } = parseArgs(name, {
          year: z.number().optional(),
          limit: z.number().optional(),
          offset: z.number().optional(),
        }, args);
        const calYear = year ?? new Date().getFullYear();
        const local = await localListCalendars(calYear, limit ?? 50, offset ?? 0);
        const localResp = await localResponse(local);
        if (localResp) return localResp;
        const results = await listCalendars(apiKey, calYear, limit ?? 50, offset ?? 0);
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      case "get_calendar": {
        const { year, calendar_no } = parseArgs(name, { year: z.number(), calendar_no: z.number() }, args);
        const local = await localGetCalendar(year, calendar_no);
        const localResp = await localResponse(local);
        if (localResp) return localResp;
        const result = await getCalendar(apiKey, year, calendar_no);
        return { content: [{ type: "text", text: withDisclaimer(result) }] };
      }

      // ── Agendas ─────────────────────────────────────────────────────────────
      case "list_agendas": {
        const { year, limit, offset } = parseArgs(name, {
          year: z.number().optional(),
          limit: z.number().optional(),
          offset: z.number().optional(),
        }, args);
        const agYear = year ?? new Date().getFullYear();
        const local = await localListAgendas(agYear, limit ?? 50, offset ?? 0);
        const localResp = await localResponse(local);
        if (localResp) return localResp;
        const results = await listAgendas(apiKey, agYear, limit ?? 50, offset ?? 0);
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      case "get_agenda": {
        const { year, agenda_no } = parseArgs(name, { year: z.number(), agenda_no: z.number() }, args);
        const local = await localGetAgenda(year, agenda_no);
        const localResp = await localResponse(local);
        if (localResp) return localResp;
        const result = await getAgenda(apiKey, year, agenda_no);
        return { content: [{ type: "text", text: withDisclaimer(result) }] };
      }

      // ── Transcripts ─────────────────────────────────────────────────────────
      case "list_floor_transcripts": {
        const { year, limit, offset } = parseArgs(name, {
          year: z.number().optional(),
          limit: z.number().optional(),
          offset: z.number().optional(),
        }, args);
        const ftYear = year ?? new Date().getFullYear();
        const local = await localListFloorTranscripts(ftYear, limit ?? 50, offset ?? 0);
        const localResp = await localResponse(local);
        if (localResp) return localResp;
        const results = await listFloorTranscripts(apiKey, ftYear, limit ?? 50, offset ?? 0);
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      case "get_floor_transcript": {
        const { date_time } = parseArgs(name, { date_time: z.string() }, args);
        // Returns null from local if text wasn't fetched (--include-transcript-text not used)
        const local = await localGetFloorTranscript(date_time);
        const localResp = await localResponse(local);
        if (localResp) return localResp;
        const result = await getFloorTranscript(apiKey, date_time);
        return { content: [{ type: "text", text: withDisclaimer(result) }] };
      }

      case "list_hearing_transcripts": {
        const { year, limit, offset } = parseArgs(name, {
          year: z.number().optional(),
          limit: z.number().optional(),
          offset: z.number().optional(),
        }, args);
        const htYear = year ?? new Date().getFullYear();
        const local = await localListHearingTranscripts(htYear, limit ?? 50, offset ?? 0);
        const localResp = await localResponse(local);
        if (localResp) return localResp;
        const results = await listHearingTranscripts(apiKey, htYear, limit ?? 50, offset ?? 0);
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      case "get_hearing_transcript": {
        const { filename } = parseArgs(name, { filename: z.string() }, args);
        // Returns null from local if text wasn't fetched (--include-transcript-text not used)
        const local = await localGetHearingTranscript(filename);
        const localResp = await localResponse(local);
        if (localResp) return localResp;
        const result = await getHearingTranscript(apiKey, filename);
        return { content: [{ type: "text", text: withDisclaimer(result) }] };
      }

      // ── Updates ─────────────────────────────────────────────────────────────
      case "get_updates": {
        const { from, to, type, content_type, limit, offset } = parseArgs(name, {
          from: z.string(),
          to: z.string(),
          type: z.enum(["processed", "published"]).optional(),
          content_type: z.enum(["bills", "agendas", "calendars", "laws"]).optional(),
          limit: z.number().optional(),
          offset: z.number().optional(),
        }, args);
        const results = await getUpdates(
          apiKey,
          from,
          to,
          type,
          content_type,
          limit ?? 50,
          offset ?? 0
        );
        return { content: [{ type: "text", text: withDisclaimer(results) }] };
      }

      // ── Search ──────────────────────────────────────────────────────────────
      case "search": {
        const { term, type, session_year, limit, offset } = parseArgs(name, {
          term: z.string(),
          type: z.string().optional(),
          session_year: z.number().optional(),
          limit: z.number().max(100).optional(),
          offset: z.number().optional(),
        }, args);
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
}
