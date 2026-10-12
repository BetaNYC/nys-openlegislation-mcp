// Regression tests for issues #20, #21 and #17 (2026-10-11).
//
// #20  get_bill_votes requested /bills/{session}/{printNo}/votes, which is not an
//      Open Legislation route (404 for every bill). Votes are part of the bill
//      response: https://legislation.nysenate.gov/static/docs/html/bills.html#get-a-single-bill
// #21  session_year was sent as a `session` query param on /bills/search, which
//      the API ignores; the documented form is /bills/{sessionYear}/search:
//      https://legislation.nysenate.gov/static/docs/html/bills.html#search-for-bills
// #17  get_member's live fallback ignored chamber; search_members could not
//      filter by chamber, carried no fullName/chamber, and needed a key.
//      https://legislation.nysenate.gov/static/docs/html/members.html
//
// Mock shapes mirror the docs:
//   - BILL_RESPONSE: the `votes` block of the "Get a single bill" sample response
//     (bills.html), including its memberVotes-by-vote-code nesting.
//   - MEMBER_GET: the "Get a single Member" sample response (members.html).
//   - MEMBER_SEARCH: members.html documents the search route but not its
//     response body. With full=true the live API returns member objects as the
//     items (responseType "member-sessions list"), not the generic
//     { result, rank } wrapper; that shape was observed live on 2026-10-11 and
//     is mirrored here.
//
// Hermetic: fetch is mocked and the corpus is a fixture in a temp dir.

import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Fixture corpus (members + bills) ─────────────────────────────────────────

const tmp = mkdtempSync(join(tmpdir(), "nys-issues-17-20-21-"));
const CORPUS = join(tmp, "corpus.db");

let Database = null;
try {
  ({ default: Database } = await import("better-sqlite3"));
} catch {
  Database = null;
}
const SKIP_SQLITE = Database ? false : "better-sqlite3 unavailable — cannot build a fixture corpus";

/** A bill row whose raw_json carries a sponsor block in the documented shape. */
function sponsorBill(sessionYear, printNo, memberId, shortName, fullName, districtCode) {
  return {
    session_year: sessionYear,
    print_no: printNo,
    raw_json: JSON.stringify({
      basePrintNo: printNo,
      session: sessionYear,
      sponsor: { member: { memberId, shortName, sessionYear, fullName, districtCode } },
    }),
  };
}

/** A member row whose raw_json is the summary shape the list endpoint returns. */
function memberRow(memberId, sessionYear, chamber, shortName, districtCode) {
  return {
    member_id: memberId,
    session_year: sessionYear,
    chamber,
    short_name: shortName,
    district: districtCode,
    raw_json: JSON.stringify({ sessionMemberId: memberId + 1000, shortName, sessionYear, districtCode, alternate: false, memberId }),
  };
}

/** The pre-2.4 schema: members has no full_name column. */
function createOldSchema(db) {
  db.exec(`
    CREATE TABLE bills (session_year INTEGER, print_no TEXT, raw_json TEXT, published_date TEXT);
    CREATE TABLE members (
      member_id INTEGER NOT NULL, session_year INTEGER NOT NULL, chamber TEXT NOT NULL,
      short_name TEXT, district INTEGER, raw_json TEXT,
      PRIMARY KEY (member_id, session_year, chamber)
    );
    CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT);
  `);
  const bill = db.prepare("INSERT INTO bills (session_year, print_no, raw_json) VALUES (@session_year, @print_no, @raw_json)");
  bill.run(sponsorBill(SESSION, "S1001", 1513, "GONZALEZ", "Kristen Gonzalez", 59));
  bill.run(sponsorBill(SESSION, "A2002", 1468, "GONZALEZ-ROJAS", "Jessica Gonzalez-Rojas", 34));
  const member = db.prepare(
    "INSERT INTO members (member_id, session_year, chamber, short_name, district, raw_json) VALUES (@member_id, @session_year, @chamber, @short_name, @district, @raw_json)"
  );
  member.run(memberRow(1513, SESSION, "SENATE", "GONZALEZ", 59));
  member.run(memberRow(1468, SESSION, "ASSEMBLY", "GONZALEZ-ROJAS", 34));
  db.prepare("INSERT INTO sync_state VALUES (?, ?)").run("last_synced_at", "2026-10-11T04:00:00");
}

const { backfillMemberFullNames } = await import("../scripts/lib/members.js");
// search_members defaults to the current session, so the fixture lives there;
// a hardcoded year would start failing when the session rolls over.
const { currentSessionYear } = await import("../dist/api.js");
const SESSION = currentSessionYear();

if (Database) {
  const db = new Database(CORPUS);
  createOldSchema(db);
  backfillMemberFullNames(db); // what sync.js / fetch-data.js now do
  db.close();
}

// db.ts binds its path at module load: set it before the first import.
process.env.NYS_CORPUS_DB = CORPUS;
const { callTool } = await import("../dist/handlers.js");
const { getBillVotes, searchBills } = await import("../dist/bills.js");
const { search } = await import("../dist/search.js");
const { getMember, searchMembers, MemberChamberMismatchError } = await import("../dist/members.js");

process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

// ─── Documented response shapes ───────────────────────────────────────────────

const BILL_RESPONSE = {
  basePrintNo: "S2180",
  session: 2013,
  printNo: "S2180",
  votes: {
    items: [
      {
        version: "",
        voteType: "COMMITTEE",
        voteDate: "2013-04-22",
        committee: { chamber: "SENATE", name: "Rules" },
        memberVotes: {
          items: {
            EXC: { items: [{ memberId: 424, shortName: "HANNON", sessionYear: 2013 }], size: 1 },
          },
          size: 1,
        },
      },
    ],
    size: 1,
  },
};

const MEMBER_GET = {
  memberId: 1468,
  chamber: "ASSEMBLY",
  incumbent: true,
  fullName: "Jessica Gonzalez-Rojas",
  shortName: "GONZALEZ-ROJAS",
};

const MEMBER_SEARCH = {
  items: [
    { memberId: 1513, chamber: "SENATE", incumbent: true, fullName: "Kristen Gonzalez", shortName: "GONZALEZ", sessionYear: 2025, districtCode: 59 },
  ],
  size: 1,
};

function installFetchMock(result) {
  const calls = [];
  mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ success: true, message: "", responseType: "test", result }),
    };
  });
  return calls;
}

const payload = (res) => JSON.parse(res.content[0].text.split("\n\n---\n")[0]);

beforeEach(() => mock.restoreAll());
afterEach(() => mock.restoreAll());

// ─── #20 get_bill_votes ───────────────────────────────────────────────────────

test("#20 get_bill_votes fetches the bill, never the nonexistent /votes route", async () => {
  const calls = installFetchMock(BILL_RESPONSE);
  await getBillVotes("test-key", 2013, "S2180");
  const url = new URL(calls[0]);
  assert.equal(url.pathname, "/api/3/bills/2013/S2180");
  assert.ok(!url.pathname.endsWith("/votes"));
  assert.equal(url.searchParams.get("view"), "no_fulltext", "documented view that keeps votes, drops full text");
});

test("#20 get_bill_votes returns the bill's votes block unchanged", async () => {
  installFetchMock(BILL_RESPONSE);
  const votes = await getBillVotes("test-key", 2013, "S2180");
  assert.deepEqual(votes, BILL_RESPONSE.votes);
  assert.equal(votes.items[0].memberVotes.items.EXC.items[0].shortName, "HANNON");
});

test("#20 a bill with no votes block yields an empty list, not undefined", async () => {
  const { votes, ...noVotes } = BILL_RESPONSE;
  installFetchMock(noVotes);
  assert.deepEqual(await getBillVotes("test-key", 2013, "S2180"), { items: [], size: 0 });
});

test("#20 the get_bill_votes tool returns votes through the handler", async () => {
  installFetchMock(BILL_RESPONSE);
  const res = await callTool("test-key", "get_bill_votes", { print_no: "S2180", session_year: 2013 });
  assert.notEqual(res.isError, true, res.content[0].text);
  assert.equal(payload(res).items[0].voteType, "COMMITTEE");
});

// ─── #21 session_year on bill search ──────────────────────────────────────────

test("#21 search_bills puts session_year in the path, not a query param", async () => {
  const calls = installFetchMock({ items: [], size: 0 });
  await searchBills("test-key", "lobbying", 2025);
  const url = new URL(calls[0]);
  assert.equal(url.pathname, "/api/3/bills/2025/search");
  assert.equal(url.searchParams.get("session"), null, "the ignored `session` param must not be sent");
  assert.equal(url.searchParams.get("term"), "lobbying");
});

test("#21 search_bills without session_year searches all sessions", async () => {
  const calls = installFetchMock({ items: [], size: 0 });
  await searchBills("test-key", "lobbying");
  assert.equal(new URL(calls[0]).pathname, "/api/3/bills/search");
});

test("#21 search with type=bills scopes by path too", async () => {
  const calls = installFetchMock({ items: [], size: 0 });
  await search("test-key", "lobbying", "bills", 2025);
  const url = new URL(calls[0]);
  assert.equal(url.pathname, "/api/3/bills/2025/search");
  assert.equal(url.searchParams.get("session"), null);
});

// ─── #17 get_member chamber guard ─────────────────────────────────────────────

test("#17 getMember throws when the live member is in the other chamber", async () => {
  installFetchMock(MEMBER_GET);
  await assert.rejects(
    () => getMember("test-key", 2025, 1468, "senate"),
    (err) => err instanceof MemberChamberMismatchError && /ASSEMBLY/.test(err.message) && /Gonzalez-Rojas/.test(err.message)
  );
});

test("#17 getMember returns the member when the chamber matches", async () => {
  installFetchMock(MEMBER_GET);
  const m = await getMember("test-key", 2025, 1468, "assembly");
  assert.equal(m.fullName, "Jessica Gonzalez-Rojas");
});

test("#17 get_member tool: Senate-scoped lookup of an Assembly member is an error", async () => {
  // The fixture corpus has 1468 only as ASSEMBLY, so the local lookup misses
  // and the live fallback runs: the exact path the issue reported.
  installFetchMock(MEMBER_GET);
  const res = await callTool("test-key", "get_member", { member_id: 1468, chamber: "senate", session_year: 2025 });
  assert.equal(res.isError, true, "must not silently return the Assembly member");
  assert.match(res.content[0].text, /ASSEMBLY/);
});

// ─── #17 live member search ───────────────────────────────────────────────────

test("#17 searchMembers sends chamber as a documented field clause, session in the path, full=true", async () => {
  const calls = installFetchMock(MEMBER_SEARCH);
  await searchMembers("test-key", "GONZALEZ", 2025, "senate");
  const url = new URL(calls[0]);
  assert.equal(url.pathname, "/api/3/members/2025/search");
  assert.equal(url.searchParams.get("term"), "(GONZALEZ) AND chamber:SENATE");
  assert.equal(url.searchParams.get("full"), "true");
  assert.equal(url.searchParams.get("chamber"), null, "the ignored `chamber` param must not be sent");
  assert.equal(url.searchParams.get("session"), null, "the undocumented `session` param must not be sent");
});

test("#17 an empty term with a chamber sends a chamber-only clause, not `() AND`", async () => {
  const calls = installFetchMock(MEMBER_SEARCH);
  await searchMembers("test-key", "  ", 2025, "assembly");
  assert.equal(new URL(calls[0]).searchParams.get("term"), "chamber:ASSEMBLY");
});

test("#17 searchMembers without chamber or session leaves the term alone", async () => {
  const calls = installFetchMock(MEMBER_SEARCH);
  await searchMembers("test-key", "districtCode:20");
  const url = new URL(calls[0]);
  assert.equal(url.pathname, "/api/3/members/search");
  assert.equal(url.searchParams.get("term"), "districtCode:20");
});

// ─── #17 local member search + backfill ───────────────────────────────────────

test("#17 search_members(Gonzalez, senate) returns exactly Kristen Gonzalez, keyless", { skip: SKIP_SQLITE }, async () => {
  const calls = installFetchMock(MEMBER_SEARCH);
  const res = await callTool(null, "search_members", { term: "Gonzalez", chamber: "senate" });
  assert.notEqual(res.isError, true, res.content[0].text);
  assert.equal(calls.length, 0, "served from the corpus, no network");
  const items = payload(res).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].fullName, "Kristen Gonzalez");
  assert.equal(items[0].chamber, "SENATE");
  assert.equal(items[0].districtCode, 59);
});

test("#17 unscoped search_members returns both, each with its own chamber, keyless", { skip: SKIP_SQLITE }, async () => {
  const res = await callTool(null, "search_members", { term: "Gonzalez" });
  const byName = Object.fromEntries(payload(res).items.map((m) => [m.fullName, m.chamber]));
  assert.deepEqual(byName, { "Kristen Gonzalez": "SENATE", "Jessica Gonzalez-Rojas": "ASSEMBLY" });
});

test("#17 a full-name term matches locally", { skip: SKIP_SQLITE }, async () => {
  const res = await callTool(null, "search_members", { term: "Jessica", session_year: SESSION });
  assert.deepEqual(payload(res).items.map((m) => m.memberId), [1468]);
});

test("#17 an ElasticSearch-only term misses locally and falls through to live with a key", { skip: SKIP_SQLITE }, async () => {
  const calls = installFetchMock(MEMBER_SEARCH);
  await callTool("test-key", "search_members", { term: "districtCode:59", chamber: "senate" });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]).searchParams.get("term"), "(districtCode:59) AND chamber:SENATE");
});

test("#17 backfill names every member, adds the column to an old corpus, and is idempotent", { skip: SKIP_SQLITE }, () => {
  const db = new Database(":memory:");
  createOldSchema(db);
  const first = backfillMemberFullNames(db);
  assert.deepEqual(first, { filled: 2, missing: 0 });
  const unnamed = db.prepare("SELECT count(*) AS n FROM members WHERE full_name IS NULL").get().n;
  assert.equal(unnamed, 0, "every member row must carry a full name after sync");
  assert.deepEqual(backfillMemberFullNames(db), { filled: 0, missing: 0 }, "re-running changes nothing");
  db.close();
});

test("#17 backfill takes the most recent session's name for a member", { skip: SKIP_SQLITE }, () => {
  const db = new Database(":memory:");
  createOldSchema(db);
  const bill = db.prepare("INSERT INTO bills (session_year, print_no, raw_json) VALUES (@session_year, @print_no, @raw_json)");
  bill.run(sponsorBill(SESSION - 2, "S0001", 1513, "GONZALEZ", "Kristen G.", 59));
  backfillMemberFullNames(db);
  const name = db.prepare("SELECT full_name FROM members WHERE member_id = 1513").get().full_name;
  assert.equal(name, "Kristen Gonzalez");
  db.close();
});
