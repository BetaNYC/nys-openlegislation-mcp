// Regression tests for endpoint URL construction (2026-07-06 review).
//
// Verified live against legislation.nysenate.gov on 2026-07-06:
//   - transcript lists live at /transcripts/{year} and /hearings/{year};
//     the old /transcripts/floor/{year} and /transcripts/hearing/{year}
//     paths return "provided request parameters was not valid".
//   - transcript gets live at /transcripts/{dateTime} and /hearings/{filename}.
//   - a member get is /members/{sessionYear}/{memberId} — the old
//     chamber-qualified /members/{session}/{chamber}/{memberId} is not a
//     get-by-id endpoint.
//   - the aggregate updates `type` query param means processed|published,
//     not a content-type filter; content filtering uses /{content}/updates/.
//
// Hermetic: `fetch` is mocked, so no live API or API key is required.

import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  listFloorTranscripts,
  getFloorTranscript,
  listHearingTranscripts,
  getHearingTranscript,
} from "../dist/transcripts.js";
import { getMember } from "../dist/members.js";
import { getUpdates } from "../dist/updates.js";

const API_KEY = "test-key";

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
        responseType: "test",
        result: { items: [], size: 0 },
      }),
    };
  };
  mock.method(globalThis, "fetch", fakeFetch);
  return calls;
}

beforeEach(() => mock.restoreAll());
afterEach(() => mock.restoreAll());

test("list_floor_transcripts hits /api/3/transcripts/{year}", async () => {
  const calls = installFetchMock();
  await listFloorTranscripts(API_KEY, 2024);
  assert.strictEqual(new URL(calls[0]).pathname, "/api/3/transcripts/2024");
});

test("get_floor_transcript hits /api/3/transcripts/{dateTime}", async () => {
  const calls = installFetchMock();
  await getFloorTranscript(API_KEY, "2024-06-07T12:28");
  assert.strictEqual(
    decodeURIComponent(new URL(calls[0]).pathname),
    "/api/3/transcripts/2024-06-07T12:28"
  );
});

test("list_hearing_transcripts hits /api/3/hearings/{year}", async () => {
  const calls = installFetchMock();
  await listHearingTranscripts(API_KEY, 2024);
  assert.strictEqual(new URL(calls[0]).pathname, "/api/3/hearings/2024");
});

test("get_hearing_transcript hits /api/3/hearings/{filename}", async () => {
  const calls = installFetchMock();
  await getHearingTranscript(API_KEY, "Taxes2024.txt");
  assert.strictEqual(new URL(calls[0]).pathname, "/api/3/hearings/Taxes2024.txt");
});

test("no transcript URL uses the invalid floor/hearing sub-paths", async () => {
  const calls = installFetchMock();
  await listFloorTranscripts(API_KEY, 2024);
  await getFloorTranscript(API_KEY, "2024-06-07T12:28");
  await listHearingTranscripts(API_KEY, 2024);
  await getHearingTranscript(API_KEY, "Taxes2024.txt");
  for (const call of calls) {
    const path = new URL(call).pathname;
    assert.ok(!path.includes("/transcripts/floor/"), `invalid path: ${path}`);
    assert.ok(!path.includes("/transcripts/hearing/"), `invalid path: ${path}`);
  }
});

test("get_member hits documented /api/3/members/{sessionYear}/{memberId}", async () => {
  const calls = installFetchMock();
  await getMember(API_KEY, 2025, 456);
  assert.strictEqual(new URL(calls[0]).pathname, "/api/3/members/2025/456");
});

test("get_updates sends type only as processed|published", async () => {
  const calls = installFetchMock();
  await getUpdates(API_KEY, "2025-01-01T00:00:00", "2025-01-02T00:00:00", "processed");
  const url = new URL(calls[0]);
  assert.strictEqual(
    decodeURIComponent(url.pathname),
    "/api/3/updates/2025-01-01T00:00:00/2025-01-02T00:00:00"
  );
  assert.strictEqual(url.searchParams.get("type"), "processed");
});

test("get_updates content filtering routes to /{content}/updates/", async () => {
  const calls = installFetchMock();
  await getUpdates(API_KEY, "2025-01-01T00:00:00", "2025-01-02T00:00:00", undefined, "bills");
  const url = new URL(calls[0]);
  assert.strictEqual(
    decodeURIComponent(url.pathname),
    "/api/3/bills/updates/2025-01-01T00:00:00/2025-01-02T00:00:00"
  );
  assert.strictEqual(url.searchParams.get("type"), null);
});

test("get_updates rejects an unknown content type without fetching", async () => {
  const calls = installFetchMock();
  await assert.rejects(
    () => getUpdates(API_KEY, "a", "b", undefined, "committees"),
    /Unsupported content type/
  );
  assert.strictEqual(calls.length, 0);
});
