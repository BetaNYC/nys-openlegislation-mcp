/**
 * Tool dispatch for nys-openlegislation-mcp.
 *
 * Split out of index.ts so tests can call tools directly without starting a
 * stdio server. Every argument parse goes through `parseArgs`, which is strict:
 * an unknown parameter raises instead of being silently dropped (issue #11).
 */
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  CAVEAT,
  currentSessionYear,
  MissingApiKeyError,
  ApiFailureError,
  type ApiKey,
} from "./api.js";
import { UpstreamError, timing } from "./http.js";
import { provenance, toolError, type ChangedByBetanyc } from "./betanyc-tools.js";
import { parseArgs, ParseArgsError, betanyc } from "./tools.js";
import { corpusDateFor, withTypeDates, type CorpusDate, type CorpusType } from "./corpusDates.js";
import {
  getBill,
  searchBills,
  listBills,
  getBillVotes,
} from "./bills.js";
import { listLaws, getLawTree, getLawSection, withNysenateUrl } from "./laws.js";
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
import {
  isEmptyLocalResult,
  annotateLocalResult,
  notInLocalCorpus,
} from "./localResult.js";
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
  localSearchMembers,
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

/** A list's page. `lowered`: the caller asked for more than the tool's maximum, so `limit` is
 * the maximum. */
type Page = { limit: number; offset: number; lowered?: boolean };

/** A list's `limit` and `offset` (#35). A whole-number `limit` above the tool's maximum is
 * lowered to the maximum (pageOf), and the paging line says so. A `limit` under 1, a negative
 * `offset` and a number that is not whole are refused with a plain message. */
const LIMIT_RULE = "must be a whole number, 1 or more (such as 25)";
const OFFSET_RULE = "must be a whole number, 0 or more (0 starts at the first result)";
const LIMIT = z.number({ invalid_type_error: LIMIT_RULE }).int(LIMIT_RULE).min(1, LIMIT_RULE).optional();
const OFFSET = z.number({ invalid_type_error: OFFSET_RULE }).int(OFFSET_RULE).min(0, OFFSET_RULE).optional();

export function pageOf(limit: number | undefined, offset: number | undefined, dflt: number, max: number): Page {
  const asked = limit ?? dflt;
  return asked > max ? { limit: max, offset: offset ?? 0, lowered: true } : { limit: asked, offset: offset ?? 0 };
}

/** Where a person can check any record from this server (DATA-SOURCES.json verify_at). */
export const VERIFY_AT = "https://legislation.nysenate.gov/";

/**
 * Which results a list answer shows, and how to get the rest (#35). `offset` counts from 0.
 * Live answers carry the API's `total`; the local copy has none, so a full page says more may
 * be available, and a short one says it is all the local copy has (not all there are).
 */
export function pagingLine(payload: unknown, page: Page, local = false): string | null {
  const items = (payload as { items?: unknown })?.items;
  if (!Array.isArray(items)) return null;
  const n = items.length;
  const total = (payload as { total?: unknown }).total;
  const first = page.offset + 1;
  const last = page.offset + n;
  const lowered = page.lowered ? ` (limit lowered to ${page.limit}, the most this tool returns)` : "";
  if (n === 0) {
    return typeof total === "number" && total > 0
      ? `No results at offset ${page.offset}${lowered}: there are ${total} in all. Use an offset below ${total}.`
      : `No results${lowered}.`;
  }
  const shown = `Showing results ${first}–${last}${lowered}`;
  if (typeof total === "number") {
    return last < total
      ? `${shown} of ${total}. For the next ${Math.min(page.limit, total - last)}, call again with offset ${last}.`
      : `${shown} of ${total}: the last page.`;
  }
  return n >= page.limit
    ? `${shown}. More may be available: call again with offset ${last}.`
    : `${shown}: all ${local ? "the local copy has" : "there are"}.`;
}

/** What BetaNYC did to a live answer: the same as about_data's "live" source (DATA-SOURCES.json,
 * changes: reshaped), so the answer and about_data agree. */
export const LIVE_CHANGES: ChangedByBetanyc = {
  kind: "modified-by-betanyc",
  detail: "passed on as the Senate's Open Legislation API returns it, with additions that change no value: " +
    "the API's paging totals, links to nysenate.gov, and an empty vote list for a bill with no votes",
};

/** What BetaNYC did to an answer from the local copy (about_data's "corpus" source). */
export const LOCAL_CHANGES: ChangedByBetanyc = {
  kind: "modified-by-betanyc",
  detail: "a copy of the Senate's Open Legislation data that BetaNYC saved and indexed on this machine; " +
    "searching it and the order of its lists are BetaNYC's own, not the Senate's",
};

/** The order line for a list answered from the local copy: BetaNYC chose the order, so its
 * page 1 can differ from the Senate's. */
export function localOrderLine(how: string): string {
  return `Order: the local copy's own (${how}), which can differ from the Senate's, so page 1 here may not be the Senate's page 1.`;
}

/** The order line for search_bills from the local copy. */
export const LOCAL_SEARCH_ORDER =
  "Order: BetaNYC's own local search (its match score is in betanyc.search_score), not the Senate's search; the Senate's results and their order can differ.";

/**
 * One data answer (#33, #34): the payload as JSON, then which results it shows (lists) and, for a
 * local list, whose order it is, then the source with its link and how current it is (shared
 * provenance(): the fetch time for a live call; for the local corpus, the date of that type of
 * data, corpusDates.ts: the sync time only for the types the sync refreshes), saying what
 * BetaNYC did to the data (changedByBetanyc, as about_data says it), and the caveat.
 */
export async function answer(payload: unknown, from: "live" | CorpusDate, page?: Page, order?: string): Promise<CallToolResult> {
  const local = from !== "live";
  const p = provenance({
    sourceName: "Open Legislation API",
    publisher: "New York State Senate",
    sourceUrl: VERIFY_AT,
    kind: local ? "snapshot" : "live",
    ...(local ? { asOf: from.asOf } : {}),
    changedByBetanyc: local ? LOCAL_CHANGES : LIVE_CHANGES,
  });
  const lines = [
    page ? pagingLine(payload, page, local) : null,
    local && page ? order ?? null : null,
    p.text,
    local ? from.note : null,
    CAVEAT,
  ].filter(Boolean);
  return { content: [{ type: "text", text: `${JSON.stringify(payload, null, 2)}\n\n---\n${lines.join("\n")}` }] };
}

export async function callTool(
  apiKey: ApiKey,
  name: string,
  args: unknown
): Promise<CallToolResult> {
  // whats_changed, about_betanyc and about_data (BetaNYC standard tools): they read this repo's
  // WHATS-CHANGED.md and DATA-SOURCES.json and answer about the server, not from Open
  // Legislation data, so they need no API key and carry no data disclaimer. callAsync, because
  // about_data's corpus freshness hook reads the corpus asynchronously.
  // about_data's "How current" for the local copy is rewritten per data type (corpusDates.ts).
  if (betanyc.handles(name)) {
    const r = await betanyc.callAsync(name, args);
    return name === "about_data" ? ((await withTypeDates(r as never)) as CallToolResult) : (r as CallToolResult);
  }

  /**
   * Wrap a local corpus result into a tool response, or return null to fall
   * through to the live API. Served results carry a
   * `source: "local corpus (synced <date>)"` note.
   *
   * Declared inside `callTool` purely so it closes over `apiKey` — the keyless
   * branch needs it, and threading a parameter through all 18 call sites would
   * be a far larger diff than moving one function.
   *
   * Empty local results normally fall through to live data. Keyless there is no
   * live data to fall through to, so they get an explicit not-found-in-corpus
   * response instead of a bare empty payload (issue #13).
   */
  async function localResponse(local: unknown, type: CorpusType, page?: Page, order?: string): Promise<CallToolResult | null> {
    if (local == null || isEmptyLocalResult(local)) {
      if (apiKey) return null;
      const date = await corpusDateFor(type);
      return answer(await notInLocalCorpus(date), date);
    }
    const date = await corpusDateFor(type);
    const annotated = await annotateLocalResult(local as object, !apiKey, date);
    return answer(annotated, date, page, order);
  }

  try {
    switch (name) {
      // ── Bills ───────────────────────────────────────────────────────────────
      case "search_bills": {
        const { term, session_year, limit, offset } = parseArgs(name, {
          term: z.string(),
          session_year: z.number().optional(),
          limit: LIMIT,
          offset: OFFSET,
        }, args);
        const page = pageOf(limit, offset, 25, 100);
        const local = await localSearchBills(term, session_year, page.limit, page.offset);
        const localResp = await localResponse(local, "bills", page, LOCAL_SEARCH_ORDER);
        if (localResp) return localResp;
        const results = await searchBills(apiKey, term, session_year, page.limit, page.offset);
        return answer(results, "live", page);
      }

      case "get_bill": {
        const { print_no, session_year } = parseArgs(name, { print_no: z.string(), session_year: z.number().optional() }, args);
        const year = session_year ?? currentSessionYear();
        const local = await localGetBill(year, print_no);
        const localResp = await localResponse(local, "bills");
        if (localResp) return localResp;
        const result = await getBill(apiKey, year, print_no);
        return answer(result, "live");
      }

      case "list_bills": {
        const { session_year, limit, offset } = parseArgs(name, {
          session_year: z.number().optional(),
          limit: LIMIT,
          offset: OFFSET,
        }, args);
        const page = pageOf(limit, offset, 25, 500);
        const year = session_year ?? currentSessionYear();
        const local = await localListBills(year, page.limit, page.offset);
        const localResp = await localResponse(local, "bills", page, localOrderLine("newest published first"));
        if (localResp) return localResp;
        const results = await listBills(apiKey, year, page.limit, page.offset);
        return answer(results, "live", page);
      }

      case "get_bill_votes": {
        const { print_no, session_year } = parseArgs(name, { print_no: z.string(), session_year: z.number().optional() }, args);
        // Votes always fetched live — they change frequently. They come from
        // the bill response; there is no separate votes endpoint (issue #20).
        const results = await getBillVotes(apiKey, session_year ?? currentSessionYear(), print_no);
        return answer(results, "live");
      }

      case "get_bill_updates": {
        const { from, to, limit, offset } = parseArgs(name, {
          from: z.string(),
          to: z.string(),
          limit: LIMIT,
          offset: OFFSET,
        }, args);
        const page = pageOf(limit, offset, 50, 500);
        // Updates always fetched live by design. Same route as get_updates
        // with content_type "bills" (issue #19 merged the duplicate).
        const results = await getUpdates(apiKey, from, to, undefined, "bills", page.limit, page.offset);
        return answer(results, "live", page);
      }

      // ── Laws ────────────────────────────────────────────────────────────────
      case "list_laws": {
        // Takes no parameters, but still parsed: an unknown key must be
        // rejected rather than ignored (issue #11).
        parseArgs(name, {}, args);
        const local = await localListLaws();
        const localResp = await localResponse(local ? { items: local, size: local.length } : null, "laws");
        if (localResp) return localResp;
        const results = await listLaws(apiKey);
        return answer(results, "live");
      }

      case "get_law_tree": {
        const { law_id } = parseArgs(name, { law_id: z.string() }, args);
        const local = await localGetLawTree(law_id);
        const localResp = await localResponse(local, "laws");
        if (localResp) return localResp;
        const result = await getLawTree(apiKey, law_id.toUpperCase());
        return answer(result, "live");
      }

      case "get_law_section": {
        const { law_id, location_id } = parseArgs(name, { law_id: z.string(), location_id: z.string() }, args);
        const local = await localGetLawSection(law_id, location_id);
        const localResp = await localResponse(local && withNysenateUrl(local), "laws");
        if (localResp) return localResp;
        const result = await getLawSection(apiKey, law_id.toUpperCase(), location_id);
        return answer(result, "live");
      }

      // ── Members ─────────────────────────────────────────────────────────────
      case "list_members": {
        const { chamber, session_year, limit, offset } = parseArgs(name, {
          chamber: z.enum(["senate", "assembly"]),
          session_year: z.number().optional(),
          limit: LIMIT,
          offset: OFFSET,
        }, args);
        const page = pageOf(limit, offset, 100, 200);
        const year = session_year ?? currentSessionYear();
        const local = await localListMembers(year, chamber, page.limit, page.offset);
        const localResp = await localResponse(local, "members", page, localOrderLine("by short name"));
        if (localResp) return localResp;
        const results = await listMembers(apiKey, year, chamber, page.limit, page.offset);
        return answer(results, "live", page);
      }

      case "get_member": {
        const { member_id, chamber, session_year } = parseArgs(name, {
          member_id: z.number(),
          chamber: z.enum(["senate", "assembly"]),
          session_year: z.number().optional(),
        }, args);
        const year = session_year ?? currentSessionYear();
        const local = await localGetMember(year, chamber, member_id);
        const localResp = await localResponse(local, "members");
        if (localResp) return localResp;
        // chamber is passed so a live result from the other chamber is an
        // error, not a silent substitute (issue #17).
        const result = await getMember(apiKey, year, member_id, chamber);
        return answer(result, "live");
      }

      case "search_members": {
        const { term, chamber, session_year, limit, offset } = parseArgs(name, {
          term: z.string(),
          chamber: z.enum(["senate", "assembly"]).optional(),
          session_year: z.number().optional(),
          limit: LIMIT,
          offset: OFFSET,
        }, args);
        const page = pageOf(limit, offset, 25, 100);
        // Local corpus first: chamber and session filter in SQL, rows carry
        // fullName + chamber, and it works keyless (issue #17).
        // session_year defaults to the current session, as the schema says.
        // Unscoped, one legislator appears once per session served, which is
        // the near-duplicate list the disambiguation rule cannot work from.
        const year = session_year ?? currentSessionYear();
        const local = await localSearchMembers(term, year, chamber, page.limit, page.offset);
        const localResp = await localResponse(local, "members", page, localOrderLine("newest session first, then by short name"));
        if (localResp) return localResp;
        const results = await searchMembers(apiKey, term, year, chamber, page.limit, page.offset);
        return answer(results, "live", page);
      }

      // ── Committees ──────────────────────────────────────────────────────────
      case "list_committees": {
        const { chamber, session_year, limit, offset } = parseArgs(name, {
          chamber: z.enum(["senate", "assembly"]),
          session_year: z.number().optional(),
          limit: LIMIT,
          offset: OFFSET,
        }, args);
        const page = pageOf(limit, offset, 100, 200);
        const year = session_year ?? currentSessionYear();
        const local = await localListCommittees(year, chamber, page.limit, page.offset);
        const localResp = await localResponse(local, "committees", page, localOrderLine("by name"));
        if (localResp) return localResp;
        const results = await listCommittees(apiKey, year, chamber, page.limit, page.offset);
        return answer(results, "live", page);
      }

      case "get_committee": {
        const { committee_name, chamber, session_year } = parseArgs(name, {
          committee_name: z.string(),
          chamber: z.enum(["senate", "assembly"]),
          session_year: z.number().optional(),
        }, args);
        const year = session_year ?? currentSessionYear();
        const local = await localGetCommittee(year, chamber, committee_name);
        const localResp = await localResponse(local, "committees");
        if (localResp) return localResp;
        const result = await getCommittee(apiKey, year, chamber, committee_name);
        return answer(result, "live");
      }

      case "get_committee_meetings": {
        const { committee_name, chamber, session_year, limit, offset } = parseArgs(name, {
          committee_name: z.string(),
          chamber: z.enum(["senate", "assembly"]),
          session_year: z.number().optional(),
          limit: LIMIT,
          offset: OFFSET,
        }, args);
        const page = pageOf(limit, offset, 25, 100);
        // Meeting history is always fetched live — schedule changes frequently
        const results = await getCommitteeMeetings(
          apiKey,
          session_year ?? currentSessionYear(),
          chamber,
          committee_name,
          page.limit,
          page.offset
        );
        return answer(results, "live", page);
      }

      // ── Calendars ───────────────────────────────────────────────────────────
      case "list_calendars": {
        const { year, limit, offset } = parseArgs(name, {
          year: z.number().optional(),
          limit: LIMIT,
          offset: OFFSET,
        }, args);
        const page = pageOf(limit, offset, 50, 200);
        const calYear = year ?? new Date().getFullYear();
        const local = await localListCalendars(calYear, page.limit, page.offset);
        const localResp = await localResponse(local, "calendars", page, localOrderLine("highest calendar number first"));
        if (localResp) return localResp;
        const results = await listCalendars(apiKey, calYear, page.limit, page.offset);
        return answer(results, "live", page);
      }

      case "get_calendar": {
        const { year, calendar_no } = parseArgs(name, { year: z.number(), calendar_no: z.number() }, args);
        const local = await localGetCalendar(year, calendar_no);
        const localResp = await localResponse(local, "calendars");
        if (localResp) return localResp;
        const result = await getCalendar(apiKey, year, calendar_no);
        return answer(result, "live");
      }

      // ── Agendas ─────────────────────────────────────────────────────────────
      case "list_agendas": {
        const { year, limit, offset } = parseArgs(name, {
          year: z.number().optional(),
          limit: LIMIT,
          offset: OFFSET,
        }, args);
        const page = pageOf(limit, offset, 50, 200);
        const agYear = year ?? new Date().getFullYear();
        const local = await localListAgendas(agYear, page.limit, page.offset);
        const localResp = await localResponse(local, "agendas", page, localOrderLine("highest agenda number first"));
        if (localResp) return localResp;
        const results = await listAgendas(apiKey, agYear, page.limit, page.offset);
        return answer(results, "live", page);
      }

      case "get_agenda": {
        const { year, agenda_no } = parseArgs(name, { year: z.number(), agenda_no: z.number() }, args);
        const local = await localGetAgenda(year, agenda_no);
        const localResp = await localResponse(local, "agendas");
        if (localResp) return localResp;
        const result = await getAgenda(apiKey, year, agenda_no);
        return answer(result, "live");
      }

      // ── Transcripts ─────────────────────────────────────────────────────────
      case "list_floor_transcripts": {
        const { year, limit, offset } = parseArgs(name, {
          year: z.number().optional(),
          limit: LIMIT,
          offset: OFFSET,
        }, args);
        const page = pageOf(limit, offset, 50, 200);
        const ftYear = year ?? new Date().getFullYear();
        const local = await localListFloorTranscripts(ftYear, page.limit, page.offset);
        const localResp = await localResponse(local, "transcripts", page, localOrderLine("newest first"));
        if (localResp) return localResp;
        const results = await listFloorTranscripts(apiKey, ftYear, page.limit, page.offset);
        return answer(results, "live", page);
      }

      case "get_floor_transcript": {
        const { date_time } = parseArgs(name, { date_time: z.string() }, args);
        // Returns null from local if text wasn't fetched (--include-transcript-text not used)
        const local = await localGetFloorTranscript(date_time);
        const localResp = await localResponse(local, "transcripts");
        if (localResp) return localResp;
        const result = await getFloorTranscript(apiKey, date_time);
        return answer(result, "live");
      }

      case "list_hearing_transcripts": {
        const { year, limit, offset } = parseArgs(name, {
          year: z.number().optional(),
          limit: LIMIT,
          offset: OFFSET,
        }, args);
        const page = pageOf(limit, offset, 50, 200);
        const htYear = year ?? new Date().getFullYear();
        const local = await localListHearingTranscripts(htYear, page.limit, page.offset);
        const localResp = await localResponse(local, "transcripts", page, localOrderLine("newest first"));
        if (localResp) return localResp;
        const results = await listHearingTranscripts(apiKey, htYear, page.limit, page.offset);
        return answer(results, "live", page);
      }

      case "get_hearing_transcript": {
        const { filename } = parseArgs(name, { filename: z.string() }, args);
        // Returns null from local if text wasn't fetched (--include-transcript-text not used)
        const local = await localGetHearingTranscript(filename);
        const localResp = await localResponse(local, "transcripts");
        if (localResp) return localResp;
        const result = await getHearingTranscript(apiKey, filename);
        return answer(result, "live");
      }

      // ── Updates ─────────────────────────────────────────────────────────────
      case "get_updates": {
        const { from, to, type, content_type, limit, offset } = parseArgs(name, {
          from: z.string(),
          to: z.string(),
          type: z.enum(["processed", "published"]).optional(),
          content_type: z.enum(["bills", "agendas", "calendars", "laws"]).optional(),
          limit: LIMIT,
          offset: OFFSET,
        }, args);
        const page = pageOf(limit, offset, 50, 500);
        const results = await getUpdates(
          apiKey,
          from,
          to,
          type,
          content_type,
          page.limit,
          page.offset
        );
        return answer(results, "live", page);
      }

      // ── Search ──────────────────────────────────────────────────────────────
      case "search": {
        const { term, type, session_year, limit, offset } = parseArgs(name, {
          term: z.string(),
          type: z.string().optional(),
          session_year: z.number().optional(),
          limit: LIMIT,
          offset: OFFSET,
        }, args);
        const page = pageOf(limit, offset, 25, 100);
        const results = await search(
          apiKey,
          term,
          type,
          session_year,
          page.limit,
          page.offset
        );
        return answer(results, "live", page);
      }

      default:
        return toolError(`Unknown tool: ${name}. Call tools/list to see the tools this server has.`);
    }
  } catch (err) {
    // The key goes in the request URL (the API takes it only as the `key` query parameter), so
    // it is redacted from everything an error passes on (#37).
    return errorResult(name, err, apiKey);
  }
}

const API = "The Open Legislation API";

/** A failure as one plain sentence, what to try, and at most 500 characters of upstream body
 * (shared toolError), with the API key redacted (#37, #38). */
export function errorResult(name: string, err: unknown, apiKey: ApiKey): CallToolResult {
  const secrets = [apiKey];
  if (err instanceof MissingApiKeyError) {
    // Named, not a generic `Error:`: the caller needs to know which tool is unavailable and
    // that the fix is configuration, not a retry. Static text, so not passed through toolError,
    // whose "Error: " prefix would read as the generic failure this message replaced.
    return { content: [{ type: "text", text: `Tool '${name}' requires the live NYS Open Legislation API. ${err.message}` }], isError: true };
  }
  if (err instanceof ParseArgsError) {
    // Already names the tool and what it accepts: passed on once, not wrapped in "<tool> failed:".
    return toolError(err.message, { secrets });
  }
  if (err instanceof z.ZodError) {
    const issues = err.issues.map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`).join("; ");
    return toolError(`Invalid arguments for ${name}: ${issues}. Fix them and call ${name} again.`, { secrets });
  }
  if (err instanceof ApiFailureError) {
    return toolError(`${API} reported a failure for ${name}. Check the arguments and try again.`, { upstreamBody: err.message, secrets });
  }
  if (err instanceof UpstreamError) {
    const body = { upstreamBody: err.body, secrets };
    if (err.kind === "timeout") {
      return toolError(`${API} did not answer within ${timing.timeoutMs / 1000} seconds. Try again in a minute; a smaller limit may help.`, { secrets });
    }
    if (err.kind === "network") {
      return toolError(`Could not reach the Open Legislation API (${err.message}). Check the network connection and try again.`, { secrets });
    }
    const s = err.status ?? 0;
    if (s === 400) return toolError(`${API} did not accept this request (HTTP 400). Check the arguments, such as the print number, session year, dates or search syntax, and try again.`, body);
    if (s === 401) return toolError(`${API} refused the API key (HTTP 401). Check that NYS_LEGISLATION_API_KEY holds a valid key from https://legislation.nysenate.gov/register.`, body);
    if (s === 404) return toolError(`${API} has nothing at that address (HTTP 404). Check the identifier and the session year or year; a list or search tool can find the right one.`, body);
    if (s === 429) return toolError(`${API}'s rate limit was reached (HTTP 429). Try again in ${err.retryAfterSec ?? 10} seconds.`, body);
    if (s >= 500) return toolError(`${API} had a problem on its side (HTTP ${s}). Try again in a few minutes.`, body);
    return toolError(`${API} answered HTTP ${s}. Check the arguments and try again.`, body);
  }
  const message = err instanceof Error ? err.message : String(err);
  return toolError(`${name} failed: ${message}`, { secrets });
}
