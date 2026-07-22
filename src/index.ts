#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOLS } from "./tools.js";
import { callTool } from "./handlers.js";

// ─── API key ──────────────────────────────────────────────────────────────────

const apiKey = process.env.NYS_LEGISLATION_API_KEY;
if (!apiKey) {
  console.error(
    "Error: NYS_LEGISLATION_API_KEY environment variable is not set.\n" +
      "Request a free API key at: https://legislation.nysenate.gov/register"
  );
  process.exit(1);
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "nys-openlegislation-mcp", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) =>
  callTool(apiKey, request.params.name, request.params.arguments)
);

// ─── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
