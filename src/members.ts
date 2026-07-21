import { apiFetch, buildUrl, type ApiKey, type PaginatedResult } from "./api.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Member = {
  memberId: number;
  shortName: string;
  sessionYear: number;
  chamber: string;
  incumbent: boolean;
  fullName: string;
  districtCode: number;
  person: {
    personId: number;
    fullName: string;
    firstName: string;
    lastName: string;
    middleName: string;
    email: string;
    officeEntries: Array<{
      name: string;
      street: string;
      city: string;
      province: string;
      postalCode: string;
      country: string;
    }>;
    prefix: string;
    suffix: string;
    verified: boolean;
    imgName: string;
  };
};

// ─── API functions ────────────────────────────────────────────────────────────

export async function listMembers(
  apiKey: ApiKey,
  sessionYear: number,
  chamber: "senate" | "assembly",
  limit = 100,
  offset = 0
): Promise<PaginatedResult<Member>> {
  const url = buildUrl(`/members/${sessionYear}/${chamber}`, apiKey, {
    limit,
    offset,
  });
  return apiFetch<PaginatedResult<Member>>(url);
}

export async function getMember(
  apiKey: ApiKey,
  sessionYear: number,
  memberId: number
): Promise<Member> {
  // Documented endpoint: /api/3/members/{sessionYear}/{memberId}.
  // (The chamber-qualified form /members/{session}/{chamber}/{memberId} is a
  // list endpoint, not a get-by-id endpoint — verified live 2026-07-06.)
  const url = buildUrl(`/members/${sessionYear}/${memberId}`, apiKey);
  return apiFetch<Member>(url);
}

export async function searchMembers(
  apiKey: ApiKey,
  term: string,
  sessionYear?: number,
  chamber?: "senate" | "assembly",
  limit = 25,
  offset = 0
): Promise<PaginatedResult<{ result: Member; rank: number }>> {
  const params: Record<string, string | number> = { term, limit, offset };
  if (sessionYear) params.session = sessionYear;
  if (chamber) params.chamber = chamber;
  const url = buildUrl("/members/search", apiKey, params);
  return apiFetch<PaginatedResult<{ result: Member; rank: number }>>(url);
}
