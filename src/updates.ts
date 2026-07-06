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

/** Content types with their own dedicated updates endpoint. */
export const UPDATE_CONTENT_TYPES = ["bills", "agendas", "calendars", "laws"] as const;
export type UpdateContentType = (typeof UPDATE_CONTENT_TYPES)[number];

// ─── API functions ────────────────────────────────────────────────────────────

/**
 * Get aggregate updates for a given date/time range.
 *
 * Per the API docs, the `type` query param selects which timestamp the range
 * filters on: "processed" (when Open Legislation processed the change) or
 * "published" (when the source data was published). It is NOT a content-type
 * filter. Content-type filtering uses the documented per-content endpoints
 * (/bills/updates/..., /agendas/updates/..., etc.) via `contentType`.
 *
 * @param from        ISO-8601 datetime, e.g. "2025-01-01T00:00:00"
 * @param to          ISO-8601 datetime, e.g. "2025-01-02T00:00:00"
 * @param type        "processed" | "published" — which timestamp the range applies to
 * @param contentType restrict to one content type (bills, agendas, calendars, laws)
 */
export async function getUpdates(
  apiKey: string,
  from: string,
  to: string,
  type?: "processed" | "published",
  contentType?: UpdateContentType,
  limit = 50,
  offset = 0
): Promise<PaginatedResult<UpdateRecord>> {
  if (contentType && !UPDATE_CONTENT_TYPES.includes(contentType)) {
    throw new Error(
      `Unsupported content type "${contentType}". Supported: ${UPDATE_CONTENT_TYPES.join(", ")}.`
    );
  }
  const params: Record<string, string | number> = { limit, offset, order: "desc" };
  if (type) params.type = type;
  const base = contentType ? `/${contentType}/updates` : "/updates";
  const url = buildUrl(
    `${base}/${encodeURIComponent(from)}/${encodeURIComponent(to)}`,
    apiKey,
    params
  );
  return apiFetch<PaginatedResult<UpdateRecord>>(url);
}
