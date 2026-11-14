// about_data: where this server's data comes from, answered from DATA-SOURCES.json by BetaNYC's
// shared module (src/betanyc-tools.ts, a copy: never edit it here; betanyc-ai-workspace
// platform/system/about-data-standard.md). These tests keep three promises: every tool has a
// documented source, the answer never says live data is fetched when the server has no API key,
// and how current the local copy is comes from the copy itself. No network: about_data reads
// only files, and the corpus here is a temporary database.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// db.ts binds its corpus path at module load: make the corpus and set it before the first import.
const dir = mkdtempSync(join(tmpdir(), "nys-about-data-"));
const CORPUS = join(dir, "corpus.db");
{
  const db = new Database(CORPUS);
  db.exec("CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT)");
  db.prepare("INSERT INTO sync_state VALUES (?, ?)").run("last_synced_at", "2026-10-22T04:00:00");
  db.close();
}
process.env.NYS_CORPUS_DB = CORPUS;

const { TOOLS, betanycTools, syncedAtAsUtc, SERVER_INSTRUCTIONS, LIVE_UNAVAILABLE_REASON, CORPUS_UNAVAILABLE_REASON } =
  await import("../dist/tools.js");
const { assertEveryToolExplained } = await import("../dist/betanyc-tools.js");

const DS_TEXT = readFileSync("DATA-SOURCES.json", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const NAMES = TOOLS.map((t) => t.name);

const ask = async (args, ctx = { hasKey: true, hasCorpus: true }) => {
  const res = await betanycTools(ctx).callAsync("about_data", args);
  return { res, body: res.structuredContent, text: res.content[0].text };
};
const one = (body, topic) => body.sources.find((s) => s.topic === topic);

test("every tool says where its data comes from, so a new tool cannot ship unexplained", () => {
  assertEveryToolExplained(DS_TEXT, NAMES);
  assert.throws(() => assertEveryToolExplained(DS_TEXT, [...NAMES, "brand_new_tool"]), /brand_new_tool/);
  assert.equal(NAMES.length, 27);
});

test("two sources, both the Senate's official records with values unchanged", async () => {
  const { body } = await ask({});
  assert.deepEqual(body.topics, ["live", "corpus"]);
  for (const s of body.sources) {
    assert.equal(s.publisher, "New York State Senate", s.topic);
    assert.equal(s.source_url, "https://legislation.nysenate.gov/static/docs/html/index.html", s.topic);
    assert.equal(s.official, true, s.topic);
    assert.equal(s.figures_official, true, `${s.topic}: reshaped only, so the figures stay official`);
    assert.deepEqual(s.changed_by_betanyc.steps, ["reshaped"], s.topic);
  }
});

test("about_data gives BetaNYC's contact address, lab@beta.nyc", async () => {
  const { body, text } = await ask({});
  assert.equal(body.contact_email, "lab@beta.nyc");
  assert.match(text, /^Questions or error reports about this data, to BetaNYC: lab@beta\.nyc$/m);
});

test("with a key: the live source is fetched when you ask", async () => {
  const s = one((await ask({ topic: "live" })).body, "live");
  assert.equal(s.as_of_status, "live");
});

test("no key: the live source says it is not available here, not 'fetched when you ask'", async () => {
  const { body, text } = await ask({ topic: "live" }, { hasKey: false, hasCorpus: true });
  const s = one(body, "live");
  assert.equal(s.as_of_status, "unavailable");
  assert.equal(s.as_of, `not available on this server: ${LIVE_UNAVAILABLE_REASON}`);
  assert.match(s.as_of, /no NYS_LEGISLATION_API_KEY/);
  assert.doesNotMatch(text, /fetched from the source when you ask/);
  // only the live source: the local copy still gives its date
  const c = one((await ask({ topic: "corpus" }, { hasKey: false, hasCorpus: true })).body, "corpus");
  assert.equal(c.as_of, "2026-10-22T04:00:00Z");
});

test("the local copy's date is its last sync, read from the copy, as UTC", async () => {
  const s = one((await ask({ topic: "corpus" })).body, "corpus");
  assert.equal(s.as_of_status, "read");
  assert.equal(s.as_of, "2026-10-22T04:00:00Z");
});

test("no local copy: the corpus source says it is not available here", async () => {
  const s = one((await ask({ topic: "corpus" }, { hasKey: true, hasCorpus: false })).body, "corpus");
  assert.equal(s.as_of_status, "unavailable");
  assert.equal(s.as_of, `not available on this server: ${CORPUS_UNAVAILABLE_REASON}`);
});

test("last_synced_at: the scripts' UTC time gets its Z back; any other shape is passed on, never guessed", () => {
  assert.equal(syncedAtAsUtc("2026-10-22T04:00:00"), "2026-10-22T04:00:00Z");
  assert.equal(syncedAtAsUtc("2026-10-22 04:00:00"), "2026-10-22 04:00:00");
  assert.equal(syncedAtAsUtc(undefined), null);
  assert.equal(syncedAtAsUtc(""), null);
});

test("a tool name works as a topic: live-only tools have one source, corpus-backed tools two", async () => {
  assert.deepEqual((await ask({ topic: "get_bill_votes" })).body.sources.map((s) => s.topic), ["live"]);
  assert.deepEqual((await ask({ topic: "get_bill" })).body.sources.map((s) => s.topic), ["live", "corpus"]);
});

test("an unknown topic is an error that lists the topics", async () => {
  const { res, text } = await ask({ topic: "weather" });
  assert.equal(res.isError, true);
  assert.match(text, /corpus/);
});

test("an unreadable DATA-SOURCES.json: the answer says so, with no error flag", async () => {
  const res = await betanycTools({ hasKey: true, hasCorpus: true, dataSourcesText: "{" }).callAsync("about_data", {});
  assert.notEqual(res.isError, true);
  assert.match(res.structuredContent.note, /cannot be read/);
  assert.equal(res.structuredContent.contact_email, null);
});

test("the server fails at startup when DATA-SOURCES.json names another repo", () => {
  const other = DS_TEXT.replace('"repository": "https://github.com/BetaNYC/nys-openlegislation-mcp"', '"repository": "https://github.com/BetaNYC/other"');
  assert.notEqual(other, DS_TEXT);
  assert.throws(() => betanycTools({ hasKey: true, hasCorpus: true, dataSourcesText: other }), /repository/);
});

test("the server's instructions say when to call about_data, about_betanyc and whats_changed", () => {
  assert.match(SERVER_INSTRUCTIONS, /call about_data/);
  assert.match(SERVER_INSTRUCTIONS, /figures_official/);
  assert.match(SERVER_INSTRUCTIONS, /call about_betanyc/);
});

test("the package ships DATA-SOURCES.json and data.json", () => {
  for (const f of ["DATA-SOURCES.json", "data.json"]) assert.ok(pkg.files.includes(f), f);
});

// Over MCP stdio, the way an AI app calls it: the built server, local-only mode (this corpus,
// no key, so no network). The SDK client checks structuredContent against the outputSchema.
test("about_data over stdio, with no key: live is not available, the copy gives its sync time", async () => {
  const env = { ...process.env, NYS_CORPUS_DB: CORPUS };
  delete env.NYS_LEGISLATION_API_KEY;
  const client = new Client({ name: "about-data-test", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env, stderr: "ignore" }));
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 27);
    const listed = tools.find((t) => t.name === "about_data");
    assert.match(listed.description, /Topics on this server: live, corpus/);
    assert.match(client.getInstructions() ?? "", /call about_data/);

    const r = await client.callTool({ name: "about_data", arguments: {} });
    const live = r.structuredContent.sources.find((s) => s.topic === "live");
    const corpus = r.structuredContent.sources.find((s) => s.topic === "corpus");
    assert.equal(live.as_of_status, "unavailable");
    assert.match(live.as_of, /no NYS_LEGISLATION_API_KEY/);
    assert.equal(corpus.as_of, "2026-10-22T04:00:00Z");
    assert.equal(r.structuredContent.contact_email, "lab@beta.nyc");
    assert.match(r.content[0].text, /Official record: yes, reshaped by BetaNYC \(values unchanged\)/);
  } finally {
    await client.close();
  }
});
