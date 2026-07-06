import { apiFetch, buildUrl, type PaginatedResult } from "./api.js";

// ─── API functions ────────────────────────────────────────────────────────────

export async function listCommittees(
  apiKey: string,
  sessionYear: number,
  chamber: "senate" | "assembly",
  limit = 100,
  offset = 0
): Promise<unknown> {
  const url = buildUrl(`/committees/${sessionYear}/${chamber}`, apiKey, {
    limit,
    offset,
  });
  return apiFetch<PaginatedResult<unknown>>(url);
}

export async function getCommittee(
  apiKey: string,
  sessionYear: number,
  chamber: "senate" | "assembly",
  committeeName: string
): Promise<unknown> {
  const url = buildUrl(
    `/committees/${sessionYear}/${chamber}/${encodeURIComponent(committeeName)}`,
    apiKey
  );
  return apiFetch<unknown>(url);
}

export async function getCommitteeMeetings(
  apiKey: string,
  sessionYear: number,
  chamber: "senate" | "assembly",
  committeeName: string,
  limit = 25,
  offset = 0
): Promise<unknown> {
  const url = buildUrl(
    `/committees/${sessionYear}/${chamber}/${encodeURIComponent(committeeName)}/meetings`,
    apiKey,
    { limit, offset }
  );
  return apiFetch<PaginatedResult<unknown>>(url);
}
