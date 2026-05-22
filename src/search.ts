import { apiFetch, buildUrl, type PaginatedResult } from "./api.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SearchResult = {
  result: unknown;
  contentType: string;
  rank: number;
  highlights: Record<string, string[]>;
};

// ─── API functions ────────────────────────────────────────────────────────────

/**
 * Full-text search across all NYS Open Legislation content using ElasticSearch syntax.
 *
 * Supports:
 *   - Simple keyword: "minimum wage"
 *   - Boolean: "minimum wage AND senate"
 *   - Field-specific: "title:\"climate\" AND sponsor:Krueger"
 *   - Wildcards: "environ*"
 *
 * Use the `type` filter to narrow to a specific content type:
 *   bills, resolutions, laws, agendas, calendars, transcripts
 */
export async function search(
  apiKey: string,
  term: string,
  type?: string,
  sessionYear?: number,
  limit = 25,
  offset = 0
): Promise<PaginatedResult<SearchResult>> {
  const params: Record<string, string | number> = { term, limit, offset };
  if (type) params.type = type;
  if (sessionYear) params.session = sessionYear;
  const url = buildUrl("/search", apiKey, params);
  return apiFetch<PaginatedResult<SearchResult>>(url);
}
