// whats_changed and about_betanyc, the two tools BetaNYC is adding to each of its MCP servers
// (betanyc-ai-workspace platform/system/whats-changed-standard.md § 7). They read this repo's
// WHATS-CHANGED.md, need no API key, and never touch the network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TOOLS } from "../dist/tools.js";
import { callTool } from "../dist/handlers.js";
import { SHARED_MODULE_VERSION } from "../dist/betanyc-tools.js";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const whatsChanged = readFileSync("WHATS-CHANGED.md", "utf8");
const REPO = "https://github.com/BetaNYC/nys-openlegislation-mcp";
// No website: an entry's link goes to the file on GitHub.
const PAGE = `${REPO}/blob/HEAD/WHATS-CHANGED.md`;
// Dated entries only: the tool leaves out an "## Unreleased:" entry (the version waiting for its tag).
const entryCount = (whatsChanged.match(/^## [0-9]{4}-[0-9]{2}-[0-9]{2}: /gm) ?? []).length;
const unreleased = (whatsChanged.match(/^## Unreleased: /gm) ?? []).length;

const textOf = (r) => r.content[0].text;

test("both shared tools are advertised, read-only, strict, with an output schema", () => {
  for (const name of ["whats_changed", "about_betanyc"]) {
    const t = TOOLS.find((x) => x.name === name);
    assert.ok(t, name);
    assert.equal(t.outputSchema.type, "object", name);
    assert.equal(t.annotations.readOnlyHint, true, name);
    assert.equal(t.inputSchema.type, "object", name);
    assert.equal(t.inputSchema.additionalProperties, false, name);
  }
  assert.equal(TOOLS.length, 26, "24 Open Legislation tools plus the two shared ones");
});

test("whats_changed answers from this repo's WHATS-CHANGED.md without an API key, every entry valid", async () => {
  const r = await callTool(null, "whats_changed", { limit: 50 });
  assert.notEqual(r.isError, true, textOf(r));
  const s = r.structuredContent;
  assert.deepEqual(s.server, { name: "nys-openlegislation-mcp", version: pkg.version });
  assert.equal(s.source, PAGE);
  assert.equal(s.history_begins, "2026-05-21");
  assert.ok(entryCount >= 9, `${entryCount} dated entries`);
  assert.equal(s.total_matching, entryCount);
  assert.equal(s.returned, entryCount);
  assert.ok(unreleased <= 1);
  if (unreleased) assert.match(s.note, /not released yet/, "the note says an unreleased entry is left out");
  else assert.equal(s.note, null);
  assert.doesNotMatch(s.note ?? "", /error/, "no entry was left out for an error");
  for (const e of s.entries) {
    assert.ok(e.url.startsWith(`${PAGE}#${e.date}-`), e.url);
    for (const l of e.links) assert.match(l.url, /^https:\/\//, `${e.title}: ${l.url}`);
  }
  assert.doesNotMatch(textOf(r), /NYS Open Legislation API, maintained by/, "no data disclaimer on an answer about the server");
});

test("the version in package.json has its own MCP entry, dated or Unreleased (release protocol)", () => {
  assert.match(whatsChanged, new RegExp(`- \\*\\*MCP version:\\*\\* \\[nys-openlegislation-mcp ${pkg.version.replace(/\./g, "\\.")}\\]`));
});

test("whats_changed filters: every Correction says what to do if you used the old answer", async () => {
  const r = await callTool(null, "whats_changed", { tag: "correction", limit: 50 });
  assert.equal(r.structuredContent.filters.tag, "Correction", "any case is accepted; answers use the canonical spelling");
  assert.ok(r.structuredContent.returned >= 3);
  for (const e of r.structuredContent.entries) {
    assert.ok(e.tags.includes("Correction"));
    assert.ok(e.if_you_used_the_old_numbers, e.title);
  }
  const since = await callTool(null, "whats_changed", { since: "2026-10-01" });
  assert.ok(since.structuredContent.returned >= 1);
  for (const e of since.structuredContent.entries) assert.ok(e.date >= "2026-10-01", e.date);
});

test("whats_changed rejects bad arguments by name", async () => {
  for (const [args, re] of [
    [{ since: "last week" }, /since must be a real date/],
    [{ tag: "Senate" }, /tag must be one of/],
    [{ limit: 51 }, /limit must be a whole number from 1 to 50/],
    [{ session_year: 2025 }, /does not accept 'session_year'/],
  ]) {
    const r = await callTool(null, "whats_changed", args);
    assert.equal(r.isError, true, JSON.stringify(args));
    assert.match(textOf(r), re);
  }
});

test("about_betanyc names the server, its version, and where to report a bug or ask for a feature", async () => {
  const r = await callTool(null, "about_betanyc", {});
  assert.notEqual(r.isError, true, textOf(r));
  const s = r.structuredContent;
  assert.deepEqual(s.server, {
    name: "nys-openlegislation-mcp",
    version: pkg.version,
    repository: REPO,
    shared_module_version: SHARED_MODULE_VERSION,
  });
  assert.equal(s.built_by, "BetaNYC, a project of the Fund for the City of New York");
  assert.deepEqual(s.bugs_and_requests, { issues: `${REPO}/issues`, new_issue: `${REPO}/issues/new` });
  assert.equal(s.whats_changed, PAGE);
  const bad = await callTool(null, "about_betanyc", { verbose: true });
  assert.equal(bad.isError, true);
  assert.match(textOf(bad), /takes no parameters/);
});

test("WHATS-CHANGED.md is listed in the package's files", () => {
  assert.ok(pkg.files.includes("WHATS-CHANGED.md"), pkg.files.join(", "));
});

test("over stdio, the SDK client accepts both answers against their output schemas", async () => {
  // Client.callTool validates structuredContent against the outputSchema from tools/list
  // and throws when it does not match, so this is the MCP contract checked end to end.
  // The server needs a key or a corpus to start; a placeholder key and no corpus give
  // live-only mode, and these two tools never use the key.
  const env = { ...process.env, NYS_LEGISLATION_API_KEY: "placeholder-not-used", NYS_CORPUS_DB: join(tmpdir(), "no-such-corpus.db") };
  const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env, stderr: "ignore" });
  const client = new Client({ name: "betanyc-tools-test", version: "0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 26);
    const wc = await client.callTool({ name: "whats_changed", arguments: { limit: 3 } });
    assert.equal(wc.structuredContent.returned, 3);
    const about = await client.callTool({ name: "about_betanyc", arguments: {} });
    assert.equal(about.structuredContent.server.version, pkg.version);
    assert.equal(client.getServerVersion().version, pkg.version);
  } finally {
    await client.close();
  }
});
