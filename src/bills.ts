import { apiFetch, buildUrl, withBillUrl, type PaginatedResult } from "./api.js";

// ─── API functions ────────────────────────────────────────────────────────────

export async function getBill(
  apiKey: string,
  sessionYear: number,
  printNo: string
): Promise<unknown> {
  const url = buildUrl(`/bills/${sessionYear}/${printNo}`, apiKey);
  const bill = await apiFetch<Record<string, unknown>>(url);
  return withBillUrl(bill, sessionYear);
}

export async function searchBills(
  apiKey: string,
  term: string,
  sessionYear?: number,
  limit = 25,
  offset = 0
): Promise<unknown> {
  const params: Record<string, string | number> = { term, limit, offset };
  if (sessionYear) {
    params.session = sessionYear;
  }
  const url = buildUrl("/bills/search", apiKey, params);
  const result = await apiFetch<PaginatedResult<{ result: Record<string, unknown>; rank: number }>>(url);
  return {
    ...result,
    items: result.items.map((item) => ({ ...item, result: withBillUrl(item.result) })),
  };
}

export async function listBills(
  apiKey: string,
  sessionYear: number,
  limit = 25,
  offset = 0
): Promise<unknown> {
  const url = buildUrl(`/bills/${sessionYear}`, apiKey, { limit, offset });
  const result = await apiFetch<PaginatedResult<Record<string, unknown>>>(url);
  return {
    ...result,
    items: result.items.map((bill) => withBillUrl(bill, sessionYear)),
  };
}

export async function getBillVotes(
  apiKey: string,
  sessionYear: number,
  printNo: string
): Promise<unknown> {
  const url = buildUrl(`/bills/${sessionYear}/${printNo}/votes`, apiKey);
  return apiFetch<unknown>(url);
}

export async function getBillUpdates(
  apiKey: string,
  from: string,
  to: string,
  limit = 50,
  offset = 0
): Promise<unknown> {
  const url = buildUrl(`/bills/updates/${from}/${to}`, apiKey, {
    limit,
    offset,
    order: "desc",
  });
  return apiFetch<unknown>(url);
}

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
): Promise<unknown> {
  const params: Record<string, string | number> = { limit, offset, order: "desc" };
  if (type) params.type = type;
  const url = buildUrl(`/updates/${encodeURIComponent(from)}/${encodeURIComponent(to)}`, apiKey, params);
  return apiFetch<unknown>(url);
}
