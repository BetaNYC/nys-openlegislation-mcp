// Contract test: the tool surface (names, descriptions, required params) must
// stay identical from a client's perspective across refactors.
//
// The snapshot fixture (test/fixtures/tools-snapshot.json) was captured from
// the pre-refactor inline tool-definition array. Any intentional change to the
// tool surface must update the fixture deliberately.
//
// Hermetic: spawns the built server over stdio with a fake API key; no network
// calls happen during tools/list.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const snapshot = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "tools-snapshot.json"), "utf8")
);

async function listTools() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "dist", "index.js")],
    env: { ...process.env, NYS_LEGISLATION_API_KEY: "test-key" },
  });
  const client = new Client({ name: "tools-contract-test", version: "0.0.0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    return tools;
  } finally {
    await client.close();
  }
}

test("tool surface matches the pre-refactor snapshot", async () => {
  const tools = await listTools();

  const actual = tools
    .map((t) => ({
      name: t.name,
      description: t.description,
      required: [...(t.inputSchema?.required ?? [])].sort(),
      properties: Object.keys(t.inputSchema?.properties ?? {}).sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const expected = [...snapshot].sort((a, b) => a.name.localeCompare(b.name));

  assert.equal(actual.length, 24, "expected exactly 24 tools");
  assert.deepEqual(actual, expected);
});
