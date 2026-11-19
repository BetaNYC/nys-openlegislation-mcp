// Runs eval/questions.json against the built server, offline (#40). See the file's _readme.
//   npm run eval            run, print a summary, save eval/runs/<date>.json
//   import { runEval }      used by test/eval.test.js
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The source line every eval answer must end with. Every eval answer is live, so only the live
 * wording passes: what BetaNYC did (as about_data says it for "live"), the fetch time in New York
 * time to the minute, and the official record at https://legislation.nysenate.gov/. Group 1 is
 * the minute. */
export const LIVE_SOURCE_LINE = new RegExp(
  "^BetaNYC modified this data: passed on as the Senate's Open Legislation API returns it, with additions that change no value: " +
    "the API's paging totals, links to nysenate.gov, and an empty vote list for a bill with no votes\\. " +
    "This copy should not be considered the official record\\. " +
    "Fetched from the source for this answer at (\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}) E[SD]T \\(New York time\\)\\. " +
    "Official record: Open Legislation API \\(New York State Senate\\), https://legislation\\.nysenate\\.gov/$",
  "m",
);
const KEY = "eval-key-not-real";

/** The value at a dotted path ("a.0.b"; an empty segment is the key ""). */
const at = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** A fixture's `"items": "50 bills"` stands for 50 stub items, so a page needs no 50 copies.
 * "… search results" stubs take the search shape, { result, rank } (bills.html, "Search for bills"). */
function expand(fixture) {
  const items = fixture?.result?.items;
  const m = typeof items === "string" && /^(\d+) /.exec(items);
  if (!m) return fixture;
  const n = Number(m[1]);
  return { ...fixture, result: { ...fixture.result, items: Array.from({ length: n }, (_, i) => (/search/.test(items) ? { result: { stub: i + 1 }, rank: 1 } : { stub: i + 1 })) } };
}

export async function runEval() {
  // No local copy, so every answer comes from the (fixture) API. Set before the server loads.
  process.env.NYS_CORPUS_DB = join(tmpdir(), "nys-eval-no-corpus", "corpus.db");
  const { callTool } = await import("../dist/handlers.js");
  const { timing } = await import("../dist/http.js");
  timing.sleep = async () => {};
  const { questions } = JSON.parse(readFileSync(join(HERE, "questions.json"), "utf8"));
  const realFetch = globalThis.fetch;
  const results = [];
  try {
    for (const q of questions) {
      const failures = [];
      const key = Object.hasOwn(q, "key") ? q.key : KEY;
      for (const step of q.steps) {
        const urls = [];
        globalThis.fetch = async (url) => {
          urls.push(new URL(String(url)));
          if (!step.fixture) throw new Error("this step must not reach the API");
          return { ok: true, status: 200, headers: new Headers(), json: async () => ({ success: true, message: "", ...expand(step.fixture) }) };
        };
        const r = await callTool(key, step.tool, step.args);
        const text = r.content?.[0]?.text ?? "";
        const c = step.check ?? {};
        const fail = (s) => failures.push(`${step.tool}: ${s}`);
        if (Boolean(r.isError) !== Boolean(c.error)) fail(`isError ${Boolean(r.isError)}, expected ${Boolean(c.error)}: ${text.slice(0, 200)}`);
        if (!step.fixture && urls.length) fail(`made ${urls.length} request(s), expected none`);
        if (c.request) {
          if (urls.length !== 1) fail(`made ${urls.length} requests, expected 1`);
          const u = urls[0];
          // Compared raw (percent-encoded), as the wire format is.
          if (u && u.pathname !== c.request.path) fail(`requested ${u.pathname}, expected ${c.request.path}`);
          for (const [k, v] of Object.entries(c.request.params ?? {})) {
            if (u && u.searchParams.get(k) !== v) fail(`param ${k}=${u.searchParams.get(k)}, expected ${v}`);
          }
        }
        if (c.json) {
          let payload;
          try { payload = JSON.parse(text.split("\n\n---\n")[0]); } catch { fail("answer has no JSON payload"); }
          for (const [path, want] of Object.entries(c.json)) {
            const got = at(payload, path);
            if (got !== want) fail(`${path} = ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
          }
        }
        if (c.text && !new RegExp(c.text, "m").test(text)) fail(`text does not match /${c.text}/`);
        // Invariants.
        if (text.includes(key ?? "\u0000")) fail("the API key appears in the answer");
        if (!r.isError && !LIVE_SOURCE_LINE.test(text)) fail("data answer has no live source line");
      }
      results.push({ id: q.id, q: q.q, pass: failures.length === 0, failures });
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const results = await runEval();
  const passed = results.filter((r) => r.pass).length;
  for (const r of results) console.error(`${r.pass ? "PASS" : "FAIL"} ${r.id} ${r.q}${r.failures.map((f) => `\n     ${f}`).join("")}`);
  console.error(`\n${passed} of ${results.length} passed`);
  const { version } = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8"));
  const now = new Date();
  // The run's file is named for its New York date.
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
  mkdirSync(join(HERE, "runs"), { recursive: true });
  writeFileSync(join(HERE, "runs", `${day}.json`), JSON.stringify({ run_at: now.toISOString(), version, passed, total: results.length, results }, null, 2) + "\n");
  process.exitCode = passed === results.length ? 0 : 1;
}
