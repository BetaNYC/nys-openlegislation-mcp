// Base API client for the NYS Open Legislation API v2.0
// https://legislation.nysenate.gov/static/docs/html/index.html

const BASE_URL = "https://legislation.nysenate.gov/api/3";

// ─── Disclaimer ──────────────────────────────────────────────────────────────

export const DISCLAIMER =
  "\n\n---\n" +
  "Data sourced from the NYS Open Legislation API, maintained by the New York State Senate. " +
  "Bill text, status, vote records, and law content reflect official legislative data but may " +
  "be subject to correction or amendment. Verify critical information at legislation.nysenate.gov.";

export function withDisclaimer(json: unknown): string {
  return JSON.stringify(json, null, 2) + DISCLAIMER;
}

// ─── Response envelope ────────────────────────────────────────────────────────

export type ApiEnvelope<T> = {
  success: boolean;
  message: string;
  responseType: string;
  result: T;
};

export type PaginatedResult<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  size: number;
};

// ─── Keyless (local-only) mode ────────────────────────────────────────────────

/**
 * The API key, or null when the server was started without one.
 *
 * Since 2.3.0 the server starts in local-only mode when NYS_LEGISLATION_API_KEY
 * is absent but a local corpus exists (issue #13), so every function that used
 * to be guaranteed a key must now admit it may not have one.
 */
export type ApiKey = string | null;

/** Thrown by `buildUrl` when a live call is attempted with no API key. */
export class MissingApiKeyError extends Error {
  constructor(message: string = MISSING_API_KEY_MESSAGE) {
    super(message);
    this.name = "MissingApiKeyError";
  }
}

/**
 * Guidance returned when a live call is attempted in local-only mode.
 *
 * Named limitation first, then the exact remedy — the caller is usually a model
 * relaying this to a human who has to act on it. Deliberately not a `.env`
 * instruction: BetaNYC keeps keys in the shell profile or the MCP client's own
 * `env` block.
 */
export const MISSING_API_KEY_MESSAGE =
  "NYS_LEGISLATION_API_KEY is not set, so the server is running in local-only " +
  "mode and can serve only the offline corpus. To enable live lookups: (1) get a free key at " +
  "https://legislation.nysenate.gov/register; (2) set it where the server can " +
  'see it — `export NYS_LEGISLATION_API_KEY="your-key"` in your shell profile, ' +
  "or the `env` block of your MCP client config — and restart the server. With " +
  "the key set, `npm run sync` also refreshes the local corpus.";

// ─── Fetch helper ─────────────────────────────────────────────────────────────

/**
 * Build a request URL, or throw if there is no API key.
 *
 * Every live call in this package routes through here, which makes this the one
 * place keyless mode has to be handled: a tool with no local corpus path throws
 * automatically, and so will any tool added later. There is deliberately no
 * allowlist of "live-only tools" to keep in sync.
 */
export function buildUrl(
  path: string,
  apiKey: ApiKey,
  params: Record<string, string | number> = {}
): string {
  if (!apiKey) throw new MissingApiKeyError();
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("key", apiKey);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

export async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`NYS Open Legislation API error ${res.status}: ${res.statusText}${body ? " — " + body : ""}`);
  }
  const data = (await res.json()) as ApiEnvelope<T>;
  if (!data.success) {
    throw new Error(`API returned failure: ${data.message}`);
  }
  return data.result;
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Current NYS legislative session year (odd-numbered year that started the 2-year session). */
export function currentSessionYear(): number {
  const year = new Date().getFullYear();
  return year % 2 === 0 ? year - 1 : year;
}

/** URL to a bill on the NYS Senate public website. */
export function billUrl(sessionYear: number, printNo: string): string {
  return `https://www.nysenate.gov/legislation/bills/${sessionYear}/${printNo}`;
}

/** Attach a url field to a bill object (or any object with basePrintNo/session/printNo fields). */
export function withBillUrl<T extends { basePrintNo?: string; printNo?: string; session?: number }>(
  bill: T,
  sessionYear?: number
): T & { url: string } {
  const printNo = bill.basePrintNo ?? bill.printNo ?? "";
  const year = bill.session ?? sessionYear ?? currentSessionYear();
  return { ...bill, url: billUrl(year, printNo) };
}
