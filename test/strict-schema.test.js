// Tests for strict tool schemas — issue #11.
//
// Regression target: unknown parameters used to be silently dropped. zod strips
// unrecognized keys by default, so a call like
//
//   search_members(term="Gonzalez", chamber="senate", bogus_unknown_param="x")
//
// returned real, correctly-sourced member records with nothing in the response
// signalling that a filter had been discarded. A consuming model cannot detect
// that, and will summarize the result as if it answered the question asked.
//
// Two layers are covered here:
//   1. every advertised inputSchema sets `additionalProperties: false`, which is
//      what makes the *calling* model aware the parameter is invalid;
//   2. `parseArgs` is strict, so anything slipping through raises server-side.
//
// Hermetic: `fetch` is mocked and no local corpus is touched (search_members
// always goes to the API — there is no local FTS for members), so these run
// offline with no API key and with or without data/corpus.db present.

import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { TOOLS } from "../dist/tools.js";
import { callTool } from "../dist/handlers.js";

const API_KEY = "test-key";

// Two real Gonzalez members, shaped like a /members/search envelope.
function installFetchMock() {
  const calls = [];
  mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        success: true,
        message: "",
        responseType: "member search results",
        result: {
          size: 2,
          items: [
            { rank: 1, result: { memberId: 1, shortName: "GONZALEZ", fullName: "Kristen Gonzalez", chamber: "senate" } },
            { rank: 2, result: { memberId: 2, shortName: "GONZALEZ A", fullName: "Alex Gonzalez", chamber: "senate" } },
          ],
        },
      }),
    };
  });
  return calls;
}

beforeEach(() => mock.restoreAll());
afterEach(() => mock.restoreAll());

// ─── Layer 1: the advertised contract ────────────────────────────────────────

test("every advertised tool schema sets additionalProperties: false", () => {
  assert.ok(TOOLS.length > 0, "expected at least one tool");
  for (const tool of TOOLS) {
    assert.equal(
      tool.inputSchema.additionalProperties,
      false,
      `${tool.name} must set additionalProperties:false so unknown params are rejected`
    );
  }
});

// ─── Layer 2: server-side enforcement ────────────────────────────────────────

test("an unknown parameter is refused, not silently dropped", async () => {
  const calls = installFetchMock();
  const res = await callTool(API_KEY, "search_members", {
    term: "Gonzalez",
    chamber: "senate",
    bogus_unknown_param: "SHOULD_REJECT",
  });
  const text = res.content[0].text;
  assert.equal(res.isError, true, `expected an error result, got: ${text}`);
  assert.match(text, /unrecognized|unknown|not permitted/i);
  assert.match(text, /bogus_unknown_param/, "the error must name the offending parameter");
  assert.doesNotMatch(text, /Gonzalez/, "must not return member records for a rejected call");
  assert.equal(calls.length, 0, "a rejected call must not reach the upstream API");
});

test("the error names the parameters the tool does accept", async () => {
  installFetchMock();
  const res = await callTool(API_KEY, "search_members", {
    term: "Gonzalez",
    bogus_unknown_param: "x",
  });
  const text = res.content[0].text;
  for (const accepted of ["term", "chamber", "session_year", "limit", "offset"]) {
    assert.match(text, new RegExp(`\\b${accepted}\\b`), `error should list '${accepted}'`);
  }
});

test("a tool that takes no parameters still refuses unknown ones", async () => {
  const res = await callTool(API_KEY, "list_laws", { bogus_unknown_param: "x" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /unrecognized|unknown|not permitted/i);
});

// ─── Regression guards: do not over-correct into rejecting valid calls ───────

test("the same call without the bogus key still returns members", async () => {
  const calls = installFetchMock();
  const res = await callTool(API_KEY, "search_members", {
    term: "Gonzalez",
    chamber: "senate",
  });
  assert.notEqual(res.isError, true, `expected success, got: ${res.content[0].text}`);
  assert.match(res.content[0].text, /Gonzalez/);
  assert.equal(calls.length, 1, "a valid call must reach the upstream API");
});

test("declared-field validation is unchanged: chamber 'SENATE' still fails the enum", async () => {
  const calls = installFetchMock();
  const res = await callTool(API_KEY, "search_members", {
    term: "Gonzalez",
    chamber: "SENATE",
  });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /invalid|expected|enum/i);
  assert.equal(calls.length, 0);
});

test("optional parameters may still be omitted", async () => {
  installFetchMock();
  const res = await callTool(API_KEY, "search_members", { term: "Gonzalez" });
  assert.notEqual(res.isError, true, `expected success, got: ${res.content[0].text}`);
});
