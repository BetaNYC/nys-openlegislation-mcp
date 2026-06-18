import { apiFetch, buildUrl, type PaginatedResult } from "./api.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SearchResult = {
  result: unknown;
  rank: number;
  highlights?: Record<string, string[]>;
};

/**
 * Content types that the NYS Open Legislation API exposes a `/{type}/search`
 * endpoint for. There is NO unified `/search` endpoint — search is per content
 * type. Verified against the live API (2026-06-18).
 *
 * Note: `resolutions` are searched through `/bills/search` (they share the bill
 * index), so there is no standalone `/resolutions/search` endpoint.
 */
export const SEARCHABLE_TYPES = [
  "bills",
  "laws",
  "agendas",
  "calendars",
  "transcripts",
  "hearings",
] as const;

export type SearchableType = (typeof SEARCHABLE_TYPES)[number];

/** Default content type when the caller does not specify one. */
export const DEFAULT_SEARCH_TYPE: SearchableType = "bills";

export function isSearchableType(value: string): value is SearchableType {
  return (SEARCHABLE_TYPES as readonly string[]).includes(value);
}

// ─── API functions ────────────────────────────────────────────────────────────

/**
 * Full-text search within a single NYS Open Legislation content type using
 * ElasticSearch syntax.
 *
 * The upstream API has no unified `/search` endpoint; each content type has its
 * own `/{type}/search` route. This function routes `type` to the correct route.
 *
 * Supported `type` values: bills, laws, agendas, calendars, transcripts,
 * hearings. When `type` is omitted it defaults to `bills`. `resolutions` is not
 * a standalone endpoint — search resolutions via `type: "bills"`.
 *
 * Term supports:
 *   - Simple keyword: "minimum wage"
 *   - Boolean: "minimum wage AND senate"
 *   - Field-specific: "title:\"climate\" AND sponsor:Krueger"
 *   - Wildcards: "environ*"
 *
 * Throws a clear, actionable error for unsupported `type` values rather than
 * surfacing a raw upstream 404.
 */
export async function search(
  apiKey: string,
  term: string,
  type?: string,
  sessionYear?: number,
  limit = 25,
  offset = 0
): Promise<PaginatedResult<SearchResult>> {
  const contentType = type ?? DEFAULT_SEARCH_TYPE;

  if (!isSearchableType(contentType)) {
    if (contentType === "resolutions") {
      throw new Error(
        'Resolutions are not a standalone search endpoint. Search resolutions with type: "bills" ' +
          "(they share the bills index)."
      );
    }
    throw new Error(
      `Unsupported search type "${contentType}". ` +
        `Supported types: ${SEARCHABLE_TYPES.join(", ")}.`
    );
  }

  const params: Record<string, string | number> = { term, limit, offset };
  // `session` only applies to the bills index; the API ignores it elsewhere,
  // but we keep it scoped to avoid sending a no-op param to other endpoints.
  if (sessionYear && contentType === "bills") params.session = sessionYear;

  const url = buildUrl(`/${contentType}/search`, apiKey, params);
  return apiFetch<PaginatedResult<SearchResult>>(url);
}
