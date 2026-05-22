import { apiFetch, buildUrl, type PaginatedResult } from "./api.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type UpdateRecord = {
  id: Record<string, unknown>;
  contentType: string;
  lastFragment: {
    type: string;
    text: string;
    date: string;
  };
};

// ─── API functions ────────────────────────────────────────────────────────────

/**
 * Get aggregate updates across all content types (bills, agendas, calendars, etc.)
 * for a given date/time range.
 *
 * @param from  ISO-8601 datetime, e.g. "2025-01-01T00:00:00"
 * @param to    ISO-8601 datetime, e.g. "2025-01-02T00:00:00"
 */
export async function getUpdates(
  apiKey: string,
  from: string,
  to: string,
  type?: string,
  limit = 50,
  offset = 0
): Promise<PaginatedResult<UpdateRecord>> {
  const params: Record<string, string | number> = { limit, offset, order: "desc" };
  if (type) params.type = type;
  const url = buildUrl(`/updates/${encodeURIComponent(from)}/${encodeURIComponent(to)}`, apiKey, params);
  return apiFetch<PaginatedResult<UpdateRecord>>(url);
}
