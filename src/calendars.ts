import { apiFetch, buildUrl, type PaginatedResult } from "./api.js";

// ─── API functions ────────────────────────────────────────────────────────────

export async function listCalendars(
  apiKey: string,
  year: number,
  limit = 50,
  offset = 0
): Promise<unknown> {
  const url = buildUrl(`/calendars/${year}`, apiKey, { limit, offset });
  return apiFetch<PaginatedResult<unknown>>(url);
}

export async function getCalendar(
  apiKey: string,
  year: number,
  calendarNo: number
): Promise<unknown> {
  const url = buildUrl(`/calendars/${year}/${calendarNo}`, apiKey);
  return apiFetch<unknown>(url);
}
