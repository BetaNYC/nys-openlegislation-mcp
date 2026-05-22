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

// ─── Fetch helper ─────────────────────────────────────────────────────────────

export function buildUrl(
  path: string,
  apiKey: string,
  params: Record<string, string | number> = {}
): string {
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
