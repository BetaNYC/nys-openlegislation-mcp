// Every data answer names its source with a link and an as-of (#33, #34); list answers have a
// hard maximum and say which results they show and how to get the rest (#35); offsets reach the
// API 1-based (#36). Offline: fetch is mocked and no local corpus is used.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";

// No local copy, so every call goes to the (mocked) live API. Set before the server modules load.
process.env.NYS_CORPUS_DB = join(tmpdir(), "nys-answers-test-no-corpus", "corpus.db");
const { callTool, pagingLine } = await import("../dist/handlers.js");
const { timing } = await import("../dist/http.js");

const KEY = "test-key";
const realSleep = timing.sleep;
beforeEach(() => { mock.restoreAll(); timing.sleep = async () => {}; });
afterEach(() => { mock.restoreAll(); timing.sleep = realSleep; });

function mockFetch(envelope) {
  const calls = [];
  mock.method(globalThis, "fetch", async (url) => {
    calls.push(new URL(String(url)));
    return { ok: true, status: 200, headers: new Headers(), json: async () => ({ success: true, message: "", ...envelope }) };
  });
  return calls;
}

const text = (r) => r.content[0].text;
// Shared module 1.5.2: what BetaNYC did (as about_data says it for "live"), the fetch time in New
// York time to the minute, and the official record's link (eval/run.js holds the pattern).
const { LIVE_SOURCE_LINE: SOURCE_LIVE } = await import("../eval/run.js");
const nyMinute = (ms) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));

test("a live answer names the source, links to it, and gives the retrieval time", async () => {
  const before = Date.now();
  for (const [name, args] of [
    ["get_bill", { print_no: "S1", session_year: 2025 }],
    ["get_bill_votes", { print_no: "S1", session_year: 2025 }],
    ["list_laws", {}],
    ["get_law_section", { law_id: "EDN", location_id: "6233" }],
  ]) {
    mock.restoreAll();
    mockFetch({ result: { items: [], size: 0, basePrintNo: "S1", session: 2025 } });
    const r = await callTool(KEY, name, args);
    assert.notEqual(r.isError, true, `${name}: ${text(r)}`);
    const m = SOURCE_LIVE.exec(text(r));
    assert.ok(m, `${name} has no source line: ${text(r).slice(-400)}`);
    assert.ok([nyMinute(before), nyMinute(Date.now())].includes(m[1]), `${name}: fetched at ${m[1]}`);
    assert.ok(text(r).split("\n\n---\n")[0].trim().startsWith("{"), "the JSON payload comes first");
  }
});

// A large fixture: the bill listing for a session, 25,520 bills in all (the size the API's own
// paging example shows), read 500 at a time.
const bills = (n, from) => Array.from({ length: n }, (_, i) => ({ basePrintNo: `S${from + i}`, session: 2025 }));

test("a long live list says which results it shows, of how many, and the next offset", async () => {
  let calls = mockFetch({ total: 25520, offsetStart: 1, offsetEnd: 500, limit: 500, result: { items: bills(500, 1), size: 500 } });
  let r = await callTool(KEY, "list_bills", { session_year: 2025, limit: 500 });
  assert.match(text(r), /^Showing results 1–500 of 25520\. For the next 500, call again with offset 500\.$/m);
  assert.equal(calls[0].searchParams.get("offset"), "1", "offset 0 is the API's position 1");

  mock.restoreAll();
  calls = mockFetch({ total: 25520, offsetStart: 501, offsetEnd: 1000, limit: 500, result: { items: bills(500, 501), size: 500 } });
  r = await callTool(KEY, "list_bills", { session_year: 2025, limit: 500, offset: 500 });
  assert.equal(calls[0].searchParams.get("offset"), "501", "the next page starts after the last result, no repeat (#36)");
  assert.match(text(r), /^Showing results 501–1000 of 25520\. For the next 500, call again with offset 1000\.$/m);

  mock.restoreAll();
  mockFetch({ total: 25520, offsetStart: 25501, offsetEnd: 25520, limit: 500, result: { items: bills(20, 25501), size: 20 } });
  r = await callTool(KEY, "list_bills", { session_year: 2025, limit: 500, offset: 25500 });
  assert.match(text(r), /^Showing results 25501–25520 of 25520: the last page\.$/m);
});

test("the default limit applies; a limit over the maximum is lowered to it, and the answer says so", async () => {
  const calls = mockFetch({ total: 3, result: { items: [], size: 0 } });
  await callTool(KEY, "search_bills", { term: "x" });
  assert.equal(calls[0].searchParams.get("limit"), "25");

  const { TOOLS } = await import("../dist/tools.js");
  const lists = {
    search_bills: [{ term: "x" }, 100], list_bills: [{}, 500], get_bill_updates: [{ from: "2025-01-01", to: "2025-01-02" }, 500],
    list_members: [{ chamber: "senate" }, 200], search_members: [{ term: "x" }, 100], list_committees: [{ chamber: "senate" }, 200],
    get_committee_meetings: [{ committee_name: "Finance", chamber: "senate" }, 100], list_calendars: [{}, 200], list_agendas: [{}, 200],
    list_floor_transcripts: [{}, 200], list_hearing_transcripts: [{}, 200], get_updates: [{ from: "2025-01-01", to: "2025-01-02" }, 500],
    search: [{ term: "x" }, 100],
  };
  // Items that fit both the list shape and the search shape ({ result, rank }).
  const three = Array.from({ length: 3 }, (_, i) => ({ basePrintNo: `S${i + 1}`, session: 2025, result: { basePrintNo: `S${i + 1}`, session: 2025 }, rank: 1 }));
  for (const [name, [args, max]] of Object.entries(lists)) {
    // The advertised schema still states the maximum.
    const schema = TOOLS.find((t) => t.name === name).inputSchema.properties.limit.description;
    assert.match(schema, new RegExp(`max ${max}\\)`), `${name}: ${schema}`);

    mock.restoreAll();
    let c = mockFetch({ total: 5000, result: { items: three, size: 3 } });
    const over = await callTool(KEY, name, { ...args, limit: max + 1 });
    assert.notEqual(over.isError, true, `${name} refused limit ${max + 1}: ${text(over)}`);
    assert.equal(c[0].searchParams.get("limit"), String(max), `${name} sends its maximum`);
    assert.match(text(over), new RegExp(`^Showing results 1–3 \\(limit lowered to ${max}, the most this tool returns\\)`, "m"), name);

    mock.restoreAll();
    c = mockFetch({ total: 5000, result: { items: three, size: 3 } });
    const atMax = await callTool(KEY, name, { ...args, limit: max });
    assert.notEqual(atMax.isError, true, `${name} refused its own maximum ${max}: ${text(atMax)}`);
    assert.doesNotMatch(text(atMax), /limit lowered/, `${name}: nothing lowered at the maximum`);

    for (const [bad, field, rule] of [
      [{ limit: 0 }, "limit", "1 or more"], [{ limit: -5 }, "limit", "1 or more"], [{ limit: 2.5 }, "limit", "whole number"],
      [{ limit: "25" }, "limit", "whole number"], [{ offset: -1 }, "offset", "0 or more"], [{ offset: 1.5 }, "offset", "whole number"],
    ]) {
      mock.restoreAll();
      c = mockFetch({ result: { items: [], size: 0 } });
      const r = await callTool(KEY, name, { ...args, ...bad });
      assert.equal(r.isError, true, `${name} accepted ${JSON.stringify(bad)}`);
      assert.equal(c.length, 0, `${name} must not call the API with ${JSON.stringify(bad)}`);
      assert.match(text(r), new RegExp(`${field}: must be a whole number, ${rule === "whole number" ? "" : rule}`), `${name}: ${text(r)}`);
      assert.ok(text(r).includes(rule), `${name}: ${text(r)}`);
    }
  }
});

test("a list with no total (the local copy) says when more may be available", () => {
  const page = { limit: 25, offset: 50 };
  assert.equal(pagingLine({ items: bills(25, 1) }, page, true), "Showing results 51–75. More may be available: call again with offset 75.");
  // The local copy may lack some: it says what it has, not that there are no more.
  assert.equal(pagingLine({ items: bills(3, 1) }, page, true), "Showing results 51–53: all the local copy has.");
  assert.equal(pagingLine({ items: bills(3, 1) }, page), "Showing results 51–53: all there are.", "a live list with no total");
  assert.equal(pagingLine({ items: [] }, page), "No results.");
  assert.equal(pagingLine({ items: [] }, { ...page, lowered: true }), "No results (limit lowered to 25, the most this tool returns).");
  assert.equal(pagingLine({ items: [], total: 40 }, page), "No results at offset 50: there are 40 in all. Use an offset below 40.");
  assert.equal(pagingLine({ notAList: true }, page), null);
});
