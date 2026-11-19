/**
 * Every request this server sends to the Open Legislation API goes through `getJson` (#32).
 *
 * Built against the API's own rules, "Rate limits" in
 * https://legislation.nysenate.gov/static/docs/html/getting_started.html (limits start
 * December 1, 2026: 10 requests per second and 4 in progress per key):
 *  - One request at a time, each started at least 100 ms after the previous one ("Send your
 *    requests one at a time, each started at least 0.1 seconds after the previous one").
 *  - A 30 s timeout, and no resend after a timeout: "Timing out and resending a slow request
 *    only adds to your requests in progress".
 *  - Retry only 429 and 503, at most twice: wait at least Retry-After (whole seconds), plus
 *    jitter; without it, back off 1 s then 2 s. "Don't retry other errors, such as a 400."
 *    A Retry-After longer than 30 s is not waited out: the error says when to try again.
 *  - A User-Agent naming this package and its version. No background polling: a request is
 *    only ever sent for a tool call.
 */
import { createRequire } from "node:module";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

export const USER_AGENT = `nys-openlegislation-mcp/${version} (+https://github.com/BetaNYC/nys-openlegislation-mcp)`;

/** Tunable for tests (sleep) only; the values are the documented rules above. */
export const timing = {
  timeoutMs: 30_000,
  minGapMs: 100,
  maxRetries: 2,
  maxWaitMs: 30_000,
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
};

export type UpstreamErrorKind = "status" | "timeout" | "network";

/** A request that got no usable answer. `body` is the upstream body as sent; the caller cuts it. */
export class UpstreamError extends Error {
  kind: UpstreamErrorKind;
  status?: number;
  body?: string;
  retryAfterSec?: number;
  constructor(kind: UpstreamErrorKind, message: string, extra: { status?: number; body?: string; retryAfterSec?: number } = {}) {
    super(message);
    this.name = "UpstreamError";
    this.kind = kind;
    Object.assign(this, extra);
  }
}

// One queue for the whole process: the API's limits are per key, and the server uses one key.
let queue: Promise<unknown> = Promise.resolve();
let lastStart = 0;

function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastStart + timing.minGapMs - Date.now();
    if (wait > 0) await timing.sleep(wait);
    lastStart = Date.now();
    return fn();
  });
  queue = run.catch(() => undefined);
  return run;
}

/** Retry-After as whole seconds (the API's documented form), or null. */
export function retryAfterSeconds(value: string | null | undefined): number | null {
  return value && /^\s*\d+\s*$/.test(value) ? Number(value) : null;
}

type Raw = { status: number; ok: boolean; retryAfter: number | null; json?: unknown; text?: string };

async function once(url: string): Promise<Raw> {
  return oneAtATime(async () => {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(timing.timeoutMs),
      });
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new UpstreamError("timeout", `no answer within ${timing.timeoutMs / 1000} seconds`);
      }
      // Node's fetch says "fetch failed" and puts the reason in `cause`; neither carries the URL.
      const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
      throw new UpstreamError("network", cause?.code ?? cause?.message ?? (err as Error)?.message ?? "network error");
    }
    // The body is read inside the slot: the API counts a request as in progress until it ends.
    const retryAfter = retryAfterSeconds(res.headers?.get?.("retry-after"));
    if (res.ok) return { status: res.status, ok: true, retryAfter, json: await res.json() };
    const text = await res.text?.().catch(() => "") ?? "";
    return { status: res.status, ok: false, retryAfter, text };
  });
}

/** GET `url` and return its parsed JSON body; throws UpstreamError when there is none. */
export async function getJson(url: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const r = await once(url);
    if (r.ok) return r.json;
    const retryable = r.status === 429 || r.status === 503;
    const waitMs = r.retryAfter !== null ? r.retryAfter * 1000 : 1000 * 2 ** attempt;
    if (retryable && attempt < timing.maxRetries && waitMs <= timing.maxWaitMs) {
      await timing.sleep(waitMs + Math.floor(Math.random() * 250));
      continue;
    }
    throw new UpstreamError("status", `HTTP ${r.status}`, {
      status: r.status,
      body: r.text,
      ...(r.retryAfter !== null ? { retryAfterSec: r.retryAfter } : {}),
    });
  }
}
