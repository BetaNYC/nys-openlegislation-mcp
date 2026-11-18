// Only protocol messages on stdout in server mode; diagnostics go to stderr (#41). Offline: the
// server is started with a dummy key and no corpus, and only calls a tool that reads its own files.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

test("server mode writes nothing but JSON-RPC messages to stdout", async () => {
  const child = spawn(process.execPath, ["dist/index.js"], {
    env: { ...process.env, NYS_LEGISLATION_API_KEY: "stdout-test-key", NYS_CORPUS_DB: "/nonexistent/corpus.db" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out; stderr: ${stderr}`)), 15000);
    child.stdout.on("data", (d) => {
      stdout += d;
      if (stdout.split("\n").some((l) => l.includes('"id":3'))) { clearTimeout(timer); resolve(); }
    });
  });
  const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "stdout-test", version: "0" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "about_betanyc", arguments: {} } });
  try {
    await done;
  } finally {
    child.kill();
  }
  const lines = stdout.split("\n").filter((l) => l.trim());
  assert.ok(lines.length >= 3, "three replies");
  for (const line of lines) {
    let msg;
    assert.doesNotThrow(() => (msg = JSON.parse(line)), `not JSON on stdout: ${line.slice(0, 120)}`);
    assert.equal(msg.jsonrpc, "2.0", `not a JSON-RPC message: ${line.slice(0, 120)}`);
  }
  assert.match(stderr, /live-only mode/, "the startup note goes to stderr");
});

test("server code never writes to stdout directly", () => {
  for (const f of readdirSync("src").filter((n) => n.endsWith(".ts"))) {
    const src = readFileSync(`src/${f}`, "utf8");
    assert.doesNotMatch(src, /console\.(log|info|debug|warn)\(|process\.stdout\.write/, `src/${f} writes to stdout`);
  }
});
