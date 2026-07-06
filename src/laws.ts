import { apiFetch, buildUrl, type PaginatedResult } from "./api.js";

// ─── API functions ────────────────────────────────────────────────────────────

export async function listLaws(apiKey: string): Promise<unknown> {
  const url = buildUrl("/laws", apiKey, { limit: 200 });
  return apiFetch<PaginatedResult<unknown>>(url);
}

export async function getLawTree(apiKey: string, lawId: string): Promise<unknown> {
  const url = buildUrl(`/laws/${lawId}`, apiKey);
  return apiFetch<unknown>(url);
}

export async function getLawSection(
  apiKey: string,
  lawId: string,
  locationId: string
): Promise<unknown> {
  const url = buildUrl(`/laws/${lawId}/${locationId}`, apiKey);
  return apiFetch<unknown>(url);
}
