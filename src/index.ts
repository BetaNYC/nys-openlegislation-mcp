#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOLS } from "./tools.js";
import { callTool } from "./handlers.js";
import { hasLocalCorpus, getDbPath } from "./db.js";

// ─── Data sources ─────────────────────────────────────────────────────────────
//
// Two independent sources: the live API (needs a key) and the local corpus
// (needs data/corpus.db). Either one alone is a usable server, so refuse to
// start only when BOTH are absent (issue #13). Exiting merely because the key
// is missing threw away a corpus already sitting on disk, and the MCP client
// showed the user nothing but "server failed to start".

const apiKey = process.env.NYS_LEGISLATION_API_KEY ?? null;
const localCorpus = hasLocalCorpus();

if (!apiKey && !localCorpus) {
  console.error(
    "Error: no data source available. nys-openlegislation-mcp needs at least one of:\n" +
      "\n" +
      "  NYS_LEGISLATION_API_KEY — live NYS Open Legislation API.\n" +
      "    Free key: https://legislation.nysenate.gov/register\n" +
      '    Set it with `export NYS_LEGISLATION_API_KEY="your-key"` in your shell\n' +
      "    profile, or in the `env` block of your MCP client config.\n" +
      "\n" +
      `  A local corpus at ${getDbPath()} — build it with \`npm run sync\`\n` +
      "    (which itself needs the key). Override the location with NYS_CORPUS_DB.\n" +
      "\n" +
      "Both together give hybrid mode, which is the recommended setup."
  );
  process.exit(1);
}

// Active mode goes to stderr — stdout is the MCP JSON channel.
console.error(
  apiKey && localCorpus
    ? "nys-openlegislation-mcp: hybrid mode (live API + local corpus)."
    : apiKey
      ? "nys-openlegislation-mcp: live-only mode (NYS Open Legislation API). Run `npm run sync` to build the local corpus."
      : "nys-openlegislation-mcp: local-only mode (offline corpus — snapshot data). Set NYS_LEGISLATION_API_KEY for live tools and current results."
);

// ─── Server ───────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "nys-openlegislation-mcp", version: "2.3.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) =>
  callTool(apiKey, request.params.name, request.params.arguments)
);

// ─── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
