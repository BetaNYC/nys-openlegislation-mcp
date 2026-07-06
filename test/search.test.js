// Tests for the `search` tool's request routing.
//
// Regression target: the tool used to hit a nonexistent unified `/search`
// endpoint, which returned HTTP 404 for every query. These tests assert that
// each content type is routed to its own `/{type}/search` endpoint and that
// unsupported types fail with a clear message rather than a raw upstream 404.
//
// Hermetic: `fetch` is mocked, so no live API or API key is required.

import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  search,
  SEARCHABLE_TYPES,
  DEFAULT_SEARCH_TYPE,
} from "../dist/search.js";

const API_KEY = "test-key";

// Capture the URL the code fetches, and return a minimal valid envelope.
function installFetchMock() {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        success: true,
        message: "",
        responseType: "search-results list",
        result: { items: [], size: 0 },
      }),
    };
  };
  mock.method(globalThis, "fetch", fakeFetch);
  return calls;
}

beforeEach(() => {
  mock.restoreAll();
});

afterEach(() => {
  mock.restoreAll();
});

test("never builds the nonexistent unified /search endpoint", async () => {
  const calls = installFetchMock();
  await search(API_KEY, "tourism", "laws");
  const path = new URL(calls[0]).pathname;
  assert.notStrictEqual(path, "/api/3/search", "must not hit the unified /search endpoint");
});

test("routes type=laws to /api/3/laws/search (the original 404 case)", async () => {
  const calls = installFetchMock();
  await search(API_KEY, "scenic byway", "laws");
  const url = new URL(calls[0]);
  assert.strictEqual(url.pathname, "/api/3/laws/search");
  assert.strictEqual(url.searchParams.get("term"), "scenic byway");
  assert.strictEqual(url.searchParams.get("key"), API_KEY);
});

test("each supported type routes to its own /{type}/search endpoint", async () => {
  for (const type of SEARCHABLE_TYPES) {
    const calls = installFetchMock();
    await search(API_KEY, "tourism", type);
    const url = new URL(calls[0]);
    assert.strictEqual(
      url.pathname,
      `/api/3/${type}/search`,
      `type=${type} should hit /${type}/search`
    );
    mock.restoreAll();
  }
});

test("omitting type defaults to bills", async () => {
  const calls = installFetchMock();
  await search(API_KEY, "tourism");
  const url = new URL(calls[0]);
  assert.strictEqual(url.pathname, `/api/3/${DEFAULT_SEARCH_TYPE}/search`);
  assert.strictEqual(url.pathname, "/api/3/bills/search");
});

test("session year is sent only for bills search", async () => {
  let calls = installFetchMock();
  await search(API_KEY, "tourism", "bills", 2025);
  assert.strictEqual(new URL(calls[0]).searchParams.get("session"), "2025");

  mock.restoreAll();
  calls = installFetchMock();
  await search(API_KEY, "tourism", "laws", 2025);
  assert.strictEqual(
    new URL(calls[0]).searchParams.get("session"),
    null,
    "session is a bills-only param and must not be sent to /laws/search"
  );
});

test("resolutions is rejected as unsupported (tool schema routes it to bills), no fetch", async () => {
  const calls = installFetchMock();
  await assert.rejects(
    () => search(API_KEY, "tourism", "resolutions"),
    /Unsupported search type "resolutions"/
  );
  assert.strictEqual(calls.length, 0, "must not fetch for an unsupported type");
});

test("unknown type fails loudly with the supported list, no fetch", async () => {
  const calls = installFetchMock();
  await assert.rejects(
    () => search(API_KEY, "tourism", "nonsense"),
    /Unsupported search type "nonsense"[\s\S]*bills, laws/
  );
  assert.strictEqual(calls.length, 0);
});

test("passes limit and offset through as query params", async () => {
  const calls = installFetchMock();
  await search(API_KEY, "tourism", "transcripts", undefined, 10, 5);
  const url = new URL(calls[0]);
  assert.strictEqual(url.searchParams.get("limit"), "10");
  assert.strictEqual(url.searchParams.get("offset"), "5");
});
