// Tests for keyless (local-only) mode — issue #13.
//
// Before this, an absent NYS_LEGISLATION_API_KEY was fatal: src/index.ts called
// process.exit(1) before a server object existed, so an MCP client showed
// "server failed to start" and the user got nothing — while a perfectly usable
// local corpus sat on disk.
//
// Three behaviors are covered:
//   1. the server starts with a corpus and no key, and still advertises tools;
//      it refuses to start only when BOTH sources are missing;
//   2. a locally-served result names the env var and the re-sync, so a
//      consuming model can tell the user why it may be stale;
//   3. an empty local result in keyless mode does NOT come back as a bare empty
//      payload. Offline, "0 rows in the corpus" and "does not exist" are
//      indistinguishable; returning the first shaped like the second is a net
//      regression over the old hard exit.
//
// Hermetic: `fetch` is mocked, no API key is used, and the corpus is a fixture
// in a temp dir (NYS_CORPUS_DB), so the repo's real data/corpus.db is never
// touched and these run identically in CI.

import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRYPOINT = join(__dirname, "..", "dist", "index.js");

// ─── Fixture corpus ───────────────────────────────────────────────────────────
// One bill, one sync_state row.
//
// better-sqlite3 is an optionalDependency and its native binding is built for
// one NODE_MODULE_VERSION, so it may be unimportable on a Node in the supported
// range. A CORPUS FILE IS STILL CREATED in that case: `hasLocalCorpus()` is an
// existsSync check, so the startup tests must see a file either way, and the
// query layer degrades to null (= empty local result) exactly as it does in
// production without the module. Only the "served local result" tests need real
// rows, and they skip.

const tmp = mkdtempSync(join(tmpdir(), "nys-keyless-"));
const CORPUS = join(tmp, "corpus.db");
const SYNCED_AT = "2026-07-21T10:30:07";

let hasSqlite = true;
try {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(CORPUS);
  db.exec(`
    CREATE TABLE bills (session_year INTEGER, print_no TEXT, raw_json TEXT, published_date TEXT);
    CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT);
  `);
  db.prepare("INSERT INTO bills VALUES (?, ?, ?, ?)").run(
    2025,
    "S1234",
    JSON.stringify({ basePrintNo: "S1234", session: 2025, title: "A fixture bill" }),
    "2025-01-08"
  );
  db.prepare("INSERT INTO sync_state VALUES (?, ?)").run("last_synced_at", SYNCED_AT);
  db.close();
} catch {
  hasSqlite = false;
  writeFileSync(CORPUS, "");
}

// A corpus path that will never exist — used for the "no data source at all" case.
const NO_CORPUS = join(tmp, "does-not-exist.db");

// db.ts binds its path at module load, so the env var must be set before the
// first import of anything that reaches it.
process.env.NYS_CORPUS_DB = CORPUS;
const { callTool } = await import("../dist/handlers.js");

process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
        responseType: "bill",
        result: { basePrintNo: "S99999", session: 2025, title: "Live bill" },
      }),
    };
  });
  return calls;
}

beforeEach(() => mock.restoreAll());
afterEach(() => mock.restoreAll());

/**
 * Child env with the key explicitly present or removed. Not `{ KEY: undefined }`
 * — whether spawn drops an undefined value has varied by Node version, and this
 * suite runs on the whole declared range.
 */
function serverEnv({ key, corpus }) {
  const env = { ...process.env, NYS_CORPUS_DB: corpus };
  if (key) env.NYS_LEGISLATION_API_KEY = key;
  else delete env.NYS_LEGISLATION_API_KEY;
  return env;
}

/**
 * Start dist/index.js, run the MCP initialize + tools/list handshake, return
 * the tool list. Rejects if the process exits before answering.
 */
function listToolsOverStdio(env, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ENTRYPOINT], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out after ${timeoutMs}ms; stderr: ${stderr}`));
    }, timeoutMs);
    const done = (fn, arg) => {
      clearTimeout(timer);
      child.kill();
      fn(arg);
    };

    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (code) =>
      done(reject, new Error(`server exited with code ${code}; stderr: ${stderr}`))
    );
    child.stdout.on("data", (d) => {
      stdout += d;
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // partial line; wait for more
        }
        if (msg.id === 2) done(resolve, { tools: msg.result?.tools ?? [], stderr });
      }
    });

    const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "keyless-mode-test", version: "0" },
      },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });
}

/** Run the entrypoint to completion and report how it exited. */
function runToExit(env, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ENTRYPOINT], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("process did not exit"));
    }, timeoutMs);
    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

// ─── 1. Startup ───────────────────────────────────────────────────────────────
// hasLocalCorpus() is an existsSync check, so these exercise the real predicate
// whether or not the fixture has queryable rows.

test("starts in local-only mode when the API key is absent but the corpus is present", async () => {
  const { tools, stderr } = await listToolsOverStdio(serverEnv({ key: null, corpus: CORPUS }));
  assert.ok(tools.length > 0, "a keyless server with a corpus must still serve tools");
  assert.match(stderr, /local-only mode/i, "the active mode must be logged to stderr");
  assert.match(
    stderr,
    /NYS_LEGISLATION_API_KEY/,
    "and must name the variable that would enable live tools"
  );
});

test("still starts with a key and no corpus (live-only mode)", async () => {
  const { tools } = await listToolsOverStdio(serverEnv({ key: "test-key", corpus: NO_CORPUS }));
  assert.ok(tools.length > 0);
});

test("refuses to start only when BOTH the key and the corpus are missing", async () => {
  const { code, stderr } = await runToExit(serverEnv({ key: null, corpus: NO_CORPUS }));
  assert.equal(code, 1, "no data source at all is the genuinely unusable case");
  assert.match(stderr, /NYS_LEGISLATION_API_KEY/);
  assert.match(stderr, /npm run sync/, "must name both remedies, not just the key");
});

// ─── 2. A served local result explains its staleness ─────────────────────────

test(
  "a locally-served result explains the staleness and names the remedy",
  { skip: hasSqlite ? false : "better-sqlite3 unavailable — cannot build a fixture corpus" },
  async () => {
    const calls = installFetchMock();
    const res = await callTool(null, "get_bill", { print_no: "S1234", session_year: 2025 });
    const text = res.content[0].text;
    assert.notEqual(res.isError, true, text);
    assert.equal(calls.length, 0, "a corpus hit must not reach the API");

    const payload = JSON.parse(text.split("\n\n---\n")[0]);
    assert.match(payload.source, /^local corpus \(synced .+\)$/);
    assert.match(
      payload.freshness,
      /NYS_LEGISLATION_API_KEY/,
      "a keyless response must name the env var the user would set"
    );
    assert.match(payload.freshness, /sync/i, "and must say a re-sync is what refreshes it");
    assert.equal(payload.title, "A fixture bill", "the actual data must still be served");
  }
);

test(
  "with a key, a served local result is annotated exactly as before (no freshness note)",
  { skip: hasSqlite ? false : "better-sqlite3 unavailable — cannot build a fixture corpus" },
  async () => {
    const res = await callTool("test-key", "get_bill", { print_no: "S1234", session_year: 2025 });
    const payload = JSON.parse(res.content[0].text.split("\n\n---\n")[0]);
    assert.match(payload.source, /^local corpus \(synced .+\)$/);
    assert.equal(payload.freshness, undefined, "a keyed response must not gain a new field");
  }
);

// ─── 3. The empty-result guard — the point of the issue ──────────────────────

test("an empty local result in keyless mode does NOT read as a true negative", async () => {
  const calls = installFetchMock();
  const res = await callTool(null, "get_bill", { print_no: "S99999", session_year: 2025 });
  const text = res.content[0].text;

  assert.equal(calls.length, 0, "keyless mode must not attempt a live call");
  assert.doesNotMatch(
    text,
    /"items"\s*:\s*\[\]/,
    "a bare empty result cannot be returned when there is no live API to confirm against"
  );
  assert.match(text, /local corpus|not found in the local/i);
  assert.match(text, /NYS_LEGISLATION_API_KEY/);
  assert.match(text, /may (also )?mean it does not exist|has not synced/i,
    "must state that existence is unconfirmed, not that the bill is absent");
});

test("the same empty local result WITH a key still falls through to the live API", async () => {
  const calls = installFetchMock();
  const res = await callTool("test-key", "get_bill", { print_no: "S99999", session_year: 2025 });
  assert.equal(calls.length, 1, "empty local results must still fall through when live is available");
  assert.match(res.content[0].text, /Live bill/);
  assert.doesNotMatch(
    res.content[0].text,
    /not_found_in_local_corpus/,
    "the keyless guard must not fire when a key is present"
  );
});

// ─── 4. Tools with no local coverage ─────────────────────────────────────────
// 6 of the 24 tools have no corpus path. They are not enumerated anywhere: they
// reach buildUrl, which throws, and so will any tool added later.

test("a live-only tool called without a key gives a named error, not a generic failure", async () => {
  const calls = installFetchMock();
  const res = await callTool(null, "search_members", { term: "Gonzalez", chamber: "senate" });
  const text = res.content[0].text;

  assert.equal(res.isError, true, text);
  assert.equal(calls.length, 0, "a keyless live call must not reach the network");
  assert.match(text, /search_members/, "the error must name the tool that is unavailable");
  assert.doesNotMatch(text, /^Error: /, "must not surface as a generic Error:");
  assert.match(text, /NYS_LEGISLATION_API_KEY/);
  assert.match(text, /legislation\.nysenate\.gov\/register/, "must link where to get a key");
  assert.doesNotMatch(text, /\.env/, "BetaNYC convention is a shell export, not a .env file");
});

test("every live-only tool refuses the same way — no allowlist to drift", async () => {
  const liveOnly = [
    ["get_bill_votes", { print_no: "S1234", session_year: 2025 }],
    ["get_bill_updates", { from: "2026-01-01T00:00:00", to: "2026-01-02T00:00:00" }],
    ["search_members", { term: "Gonzalez" }],
    ["get_committee_meetings", { committee_name: "Finance", chamber: "senate" }],
    ["get_updates", { from: "2026-01-01T00:00:00", to: "2026-01-02T00:00:00" }],
    ["search", { term: "climate" }],
  ];
  const calls = installFetchMock();
  for (const [name, args] of liveOnly) {
    const res = await callTool(null, name, args);
    assert.equal(res.isError, true, `${name} should refuse without a key`);
    assert.match(res.content[0].text, new RegExp(`Tool '${name}' requires the live`), name);
  }
  assert.equal(calls.length, 0);
});

test("with a key, live-only tools are unaffected", async () => {
  const calls = installFetchMock();
  const res = await callTool("test-key", "search", { term: "climate" });
  assert.notEqual(res.isError, true, res.content[0].text);
  assert.equal(calls.length, 1);
});
