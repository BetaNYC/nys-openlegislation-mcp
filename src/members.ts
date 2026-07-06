import { apiFetch, buildUrl, type PaginatedResult } from "./api.js";

// ─── API functions ────────────────────────────────────────────────────────────

export async function listMembers(
  apiKey: string,
  sessionYear: number,
  chamber: "senate" | "assembly",
  limit = 100,
  offset = 0
): Promise<unknown> {
  const url = buildUrl(`/members/${sessionYear}/${chamber}`, apiKey, {
    limit,
    offset,
  });
  return apiFetch<PaginatedResult<unknown>>(url);
}

export async function getMember(
  apiKey: string,
  sessionYear: number,
  chamber: "senate" | "assembly",
  memberId: number
): Promise<unknown> {
  const url = buildUrl(`/members/${sessionYear}/${chamber}/${memberId}`, apiKey);
  return apiFetch<unknown>(url);
}

export async function searchMembers(
  apiKey: string,
  term: string,
  sessionYear?: number,
  chamber?: "senate" | "assembly",
  limit = 25,
  offset = 0
): Promise<unknown> {
  const params: Record<string, string | number> = { term, limit, offset };
  if (sessionYear) params.session = sessionYear;
  if (chamber) params.chamber = chamber;
  const url = buildUrl("/members/search", apiKey, params);
  return apiFetch<PaginatedResult<unknown>>(url);
}
