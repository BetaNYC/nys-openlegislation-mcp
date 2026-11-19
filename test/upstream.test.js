// Upstream requests (#32), errors (#38) and the API key in error text (#37). Offline: fetch is mocked.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { getJson, timing, USER_AGENT } from "../dist/http.js";
import { callTool } from "../dist/handlers.js";

const KEY = "sekret-KEY-123/+=";
const realSleep = timing.sleep;
let sleeps;

beforeEach(() => {
  mock.restoreAll();
  sleeps = [];
  timing.sleep = async (ms) => { sleeps.push(ms); };
});
afterEach(() => {
  mock.restoreAll();
  timing.sleep = realSleep;
});

const ok = (envelope) => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ success: true, message: "", ...envelope }) });
const fail = (status, body = "", headers = {}) => ({ ok: false, status, headers: new Headers(headers), text: async () => body, json: async () => JSON.parse(body) });

/** Answers in turn from `replies` (the last one repeats); records each call. */
function mockFetch(...replies) {
  const calls = [];
  mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: String(url), init });
    return replies[Math.min(calls.length - 1, replies.length - 1)];
  });
  return calls;
}

const text = (r) => r.content[0].text;

test("every request names the package and version, and carries a timeout", async () => {
  const calls = mockFetch(ok({ result: { a: 1 } }));
  await getJson("https://example.test/x");
  assert.equal(calls[0].init.headers["User-Agent"], USER_AGENT);
  assert.match(USER_AGENT, /^nys-openlegislation-mcp\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\/BetaNYC\/nys-openlegislation-mcp\)$/);
  assert.ok(calls[0].init.signal instanceof AbortSignal, "a timeout signal");
  assert.ok(timing.timeoutMs >= 15_000 && timing.timeoutMs <= 30_000);
});

test("a 429 is retried after Retry-After, then succeeds", async () => {
  const calls = mockFetch(fail(429, '{"errorCode":703}', { "Retry-After": "2" }), ok({ result: "done" }));
  const r = await getJson("https://example.test/x");
  assert.equal(r.result, "done");
  assert.equal(calls.length, 2);
  const wait = sleeps.find((ms) => ms >= 2000);
  assert.ok(wait >= 2000 && wait < 2250, `waited ${wait} ms: Retry-After plus jitter`);
});

test("a 503 is retried; gives up after two retries", async () => {
  const calls = mockFetch(fail(503, "busy"));
  await assert.rejects(getJson("https://example.test/x"), (e) => e.status === 503);
  assert.equal(calls.length, 3, "one try and two retries");
});

test("a 400 or a 500 is not retried", async () => {
  for (const status of [400, 500]) {
    mock.restoreAll();
    const calls = mockFetch(fail(status, "bad"));
    await assert.rejects(getJson("https://example.test/x"), (e) => e.status === status);
    assert.equal(calls.length, 1, `HTTP ${status}`);
  }
});

test("a Retry-After past 30 seconds is not waited out; the error says when to try again", async () => {
  const calls = mockFetch(fail(429, "slow down", { "Retry-After": "120" }));
  const r = await callTool(KEY, "get_bill", { print_no: "S1", session_year: 2025 });
  assert.equal(calls.length, 1);
  assert.equal(r.isError, true);
  assert.match(text(r), /rate limit was reached \(HTTP 429\)\. Try again in 120 seconds\./);
});

test("requests go one at a time, at least 100 ms apart", async () => {
  let inFlight = 0;
  let most = 0;
  const starts = [];
  timing.sleep = realSleep;
  mock.method(globalThis, "fetch", async () => {
    starts.push(Date.now());
    most = Math.max(most, ++inFlight);
    await new Promise((r) => setTimeout(r, 20));
    inFlight--;
    return ok({ result: 1 });
  });
  await Promise.all([getJson("https://example.test/1"), getJson("https://example.test/2"), getJson("https://example.test/3")]);
  assert.equal(most, 1, "never two requests in progress");
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 99, `gap ${starts[i] - starts[i - 1]} ms`);
});

test("a timeout is reported in plain words and not resent", async () => {
  let n = 0;
  mock.method(globalThis, "fetch", async () => {
    n++;
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  });
  const r = await callTool(KEY, "get_bill", { print_no: "S1", session_year: 2025 });
  assert.equal(n, 1);
  assert.equal(r.isError, true);
  assert.match(text(r), /did not answer within 30 seconds\. Try again/);
});

test("the API key never reaches error text, and the upstream body is cut to 500 characters", async () => {
  // The key travels in the URL; a body that echoes the URL, raw and percent-encoded, must not leak it.
  const url = `https://legislation.nysenate.gov/api/3/bills/2025/S1?key=${encodeURIComponent(KEY)}`;
  const body = `{"message":"bad request ${url} key=${KEY}"}` + "x".repeat(2000);
  for (const status of [400, 401, 404, 500, 418]) {
    mock.restoreAll();
    mockFetch(fail(status, body));
    const r = await callTool(KEY, "get_bill", { print_no: "S1", session_year: 2025 });
    const t = text(r);
    assert.equal(r.isError, true, `HTTP ${status}`);
    assert.ok(!t.includes(KEY) && !t.includes(encodeURIComponent(KEY)), `HTTP ${status} leaked the key: ${t.slice(0, 200)}`);
    assert.match(t, /\[redacted\]/);
    assert.match(t, /cut at 500 characters/);
    assert.ok(t.length < 900, `HTTP ${status}: ${t.length} characters`);
    assert.doesNotMatch(t, /^\s+at /m, "no stack frames");
  }
});

test("a network failure and a success:false answer are plain sentences without the key", async () => {
  mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed", { cause: Object.assign(new Error(`getaddrinfo ENOTFOUND ${KEY}`), { code: "ENOTFOUND" }) });
  });
  let r = await callTool(KEY, "get_bill", { print_no: "S1", session_year: 2025 });
  assert.match(text(r), /^Error: Could not reach the Open Legislation API \(ENOTFOUND\)\. Check the network connection/);
  assert.ok(!text(r).includes(KEY));

  mock.restoreAll();
  mockFetch({ ok: true, status: 200, headers: new Headers(), json: async () => ({ success: false, message: `no luck for key ${KEY}` }) });
  r = await callTool(KEY, "get_bill", { print_no: "S1", session_year: 2025 });
  assert.equal(r.isError, true);
  assert.match(text(r), /reported a failure for get_bill/);
  assert.ok(!text(r).includes(KEY));
});

test("bad arguments are named in a sentence, not a JSON dump", async () => {
  const calls = mockFetch(ok({ result: {} }));
  // A limit over the maximum is lowered, not refused; a limit under 1 is refused.
  const r = await callTool(KEY, "search_bills", { term: "x", limit: 0 });
  assert.equal(r.isError, true);
  assert.equal(calls.length, 0);
  assert.match(text(r), /^Error: Invalid arguments for search_bills: limit: .+\. Fix them and call search_bills again\.$/);
  assert.doesNotMatch(text(r), /"code"/);
});

test("a network failure with no code gives only the first plain line of its cause", async () => {
  mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed", {
      cause: new Error("socket hang up\n    at TLSSocket.onClose (node:internal/tls/wrap:1:2)\nsecond line from /home/someone/app.js"),
    });
  });
  const r = await callTool(KEY, "get_bill", { print_no: "S1", session_year: 2025 });
  assert.equal(r.isError, true);
  assert.match(text(r), /^Error: Could not reach the Open Legislation API \(socket hang up\)\. Check the network connection/);
  assert.doesNotMatch(text(r), /second line|\/home\/|^\s+at /m);
});

// A key whose URL-encoded and form-encoded forms differ (a space is %20 in one and + in the other;
// "!" is kept by encodeURIComponent and encoded by URLSearchParams): each form must be redacted.
test("a key with a space and '!' is redacted raw, URL-encoded and form-encoded", async () => {
  const key = "my sekret key!42";
  const forms = [key, encodeURIComponent(key), new URLSearchParams({ k: key }).toString().slice(2)];
  assert.notEqual(forms[1], forms[2], "the two encodings differ for this key");
  mockFetch(fail(400, `echo: ${forms.join(" | ")}`));
  const r = await callTool(key, "get_bill", { print_no: "S1", session_year: 2025 });
  const t = text(r);
  assert.equal(r.isError, true);
  for (const f of forms) assert.ok(!t.includes(f), `leaked ${f}: ${t}`);
  assert.equal(t.split("[redacted]").length - 1, 3, t);
});
