// #18 nysenate_url, #19 get_bill_updates dedupe, envelope totals, serverInfo version.
// Hermetic: fetch is mocked; the server is started with a fake key and never calls out.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

import { nysenateLawUrl } from "../dist/laws.js";
import { getLawSection } from "../dist/laws.js";
import { search } from "../dist/search.js";
import { listBills } from "../dist/bills.js";
import { callTool } from "../dist/handlers.js";

const KEY = "test-key";

function mockFetch(envelope) {
  const calls = [];
  mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    return { ok: true, status: 200, statusText: "OK", json: async () => ({ success: true, message: "", responseType: "t", ...envelope }) };
  });
  return calls;
}

beforeEach(() => mock.restoreAll());
afterEach(() => mock.restoreAll());

test("#18: nysenate_url only for verified doc types, null otherwise", () => {
  assert.equal(nysenateLawUrl({ lawId: "EDN", locationId: "6233", docType: "SECTION" }), "https://www.nysenate.gov/legislation/laws/EDN/6233");
  assert.equal(nysenateLawUrl({ lawId: "EDN", locationId: "A125", docType: "ARTICLE" }), "https://www.nysenate.gov/legislation/laws/EDN/A125");
  assert.equal(nysenateLawUrl({ lawId: "EDN", locationId: "-CH16", docType: "CHAPTER" }), null);
  assert.equal(nysenateLawUrl({ lawId: "EDN", locationId: "T1", docType: "TITLE" }), null);
  assert.equal(nysenateLawUrl({ lawId: "EDN", locationId: "6233" }), null, "no docType, no link");
});

test("#18: get_law_section and law search results carry nysenate_url", async () => {
  mockFetch({ result: { lawId: "EDN", locationId: "6233", docType: "SECTION", text: "…" } });
  assert.equal((await getLawSection(KEY, "EDN", "6233")).nysenate_url, "https://www.nysenate.gov/legislation/laws/EDN/6233");

  mockFetch({ total: 2, result: { items: [
    { result: { lawId: "EDN", locationId: "A125", docType: "ARTICLE" }, rank: 1 },
    { result: { lawId: "EDN", locationId: "T1", docType: "TITLE" }, rank: 2 },
  ], size: 2 } });
  const hits = await search(KEY, "cuny", "laws");
  assert.deepEqual(hits.items.map((i) => i.result.nysenate_url), ["https://www.nysenate.gov/legislation/laws/EDN/A125", null]);

  mockFetch({ result: { items: [{ result: { printNo: "S1" }, rank: 1 }], size: 1 } });
  const bills = await search(KEY, "x", "bills");
  assert.equal("nysenate_url" in bills.items[0].result, false, "bill hits are untouched");
});

test("paginated responses keep the envelope's total and offsets", async () => {
  mockFetch({ total: 616, offsetStart: 1, offsetEnd: 25, limit: 25, result: { items: [{ printNo: "S1", session: 2025 }], size: 1 } });
  const page = await listBills(KEY, 2025);
  assert.equal(page.total, 616);
  assert.equal(page.offsetEnd, 25);
  assert.equal(page.items[0].url, "https://www.nysenate.gov/legislation/bills/2025/S1");
  const { apiFetch } = await import("../dist/api.js");
  mockFetch({ total: 2, result: ["a", "b"] });
  assert.deepEqual(await apiFetch("https://x/"), ["a", "b"], "an array result is returned as-is");
});

test("#19: get_bill_updates routes to /bills/updates/{from}/{to}", async () => {
  const calls = mockFetch({ result: { items: [], size: 0 } });
  await callTool(KEY, "get_bill_updates", { from: "2025-01-01T00:00:00", to: "2025-01-02T00:00:00" });
  const url = new URL(calls[0]);
  // Pinned raw, not decoded: the dates go out percent-encoded, as get_updates
  // has always sent them, so the wire format is a tested choice.
  assert.equal(url.pathname, "/api/3/bills/updates/2025-01-01T00%3A00%3A00/2025-01-02T00%3A00%3A00");
  assert.equal(url.searchParams.get("order"), "desc");
});

test("serverInfo version matches package.json", async () => {
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
  const child = spawn(process.execPath, [new URL("../dist/index.js", import.meta.url).pathname], {
    env: { ...process.env, NYS_LEGISLATION_API_KEY: "test-key", NYS_CORPUS_DB: "/nonexistent/corpus.db" },
  });
  const reply = new Promise((resolve, reject) => {
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d;
      const line = buf.split("\n").find((l) => l.includes('"serverInfo"'));
      if (line) resolve(JSON.parse(line));
    });
    child.on("error", reject);
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
    protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } } }) + "\n");
  try {
    assert.equal((await reply).result.serverInfo.version, version);
  } finally {
    child.kill();
  }
});
