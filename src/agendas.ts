import { apiFetch, buildUrl, type PaginatedResult } from "./api.js";

// ─── API functions ────────────────────────────────────────────────────────────

export async function listAgendas(
  apiKey: string,
  year: number,
  limit = 50,
  offset = 0
): Promise<unknown> {
  const url = buildUrl(`/agendas/${year}`, apiKey, { limit, offset });
  return apiFetch<PaginatedResult<unknown>>(url);
}

export async function getAgenda(
  apiKey: string,
  year: number,
  agendaNo: number
): Promise<unknown> {
  const url = buildUrl(`/agendas/${year}/${agendaNo}`, apiKey);
  return apiFetch<unknown>(url);
}
