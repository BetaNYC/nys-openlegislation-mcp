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

/** Thrown when a member exists but sits in a different chamber than requested (issue #17). */
export class MemberChamberMismatchError extends Error {
  constructor(memberId: number, requested: string, actual: string, fullName?: string) {
    super(
      `Member ${memberId}${fullName ? ` (${fullName})` : ""} is in the ${actual}, ` +
        `not the ${requested.toUpperCase()}. Re-run with chamber: "${actual.toLowerCase()}" ` +
        "if that is the member you meant."
    );
    this.name = "MemberChamberMismatchError";
  }
}

export async function getMember(
  apiKey: ApiKey,
  sessionYear: number,
  memberId: number,
  chamber?: "senate" | "assembly"
): Promise<Member> {
  // Documented endpoint: /api/3/members/{sessionYear}/{memberId}.
  // https://legislation.nysenate.gov/static/docs/html/members.html#get-a-single-member
  // (The chamber-qualified form /members/{session}/{chamber}/{memberId} is a
  // list endpoint, not a get-by-id endpoint — verified live 2026-07-06.)
  const url = buildUrl(`/members/${sessionYear}/${memberId}`, apiKey);
  const member = await apiFetch<Member>(url);
  // The endpoint takes no chamber, so the caller's chamber has to be enforced
  // here. Without this, a Senate-scoped lookup that the local corpus correctly
  // missed would fall through and return an Assembly member (issue #17).
  if (chamber && member.chamber && member.chamber.toUpperCase() !== chamber.toUpperCase()) {
    throw new MemberChamberMismatchError(memberId, chamber, member.chamber.toUpperCase(), member.fullName);
  }
  return member;
}

/** Member search route, scoped to one session year when given. */
export function memberSearchPath(sessionYear?: number): string {
  // https://legislation.nysenate.gov/static/docs/html/members.html#search-for-members
  //   (GET) /api/3/members/search?term=...               across all session years
  //   (GET) /api/3/members/{sessionYear}/search?term=... within one session year
  return sessionYear ? `/members/${sessionYear}/search` : "/members/search";
}

/**
 * The search term actually sent upstream. `/members/search` has no chamber
 * parameter (a `chamber` query param is ignored: issue #17), but the search
 * index is built from the response JSON, so any response field can be queried
 * with an ElasticSearch field clause chained by AND:
 * https://legislation.nysenate.gov/static/docs/html/search_api.html#term
 */
export function memberSearchTerm(term: string, chamber?: "senate" | "assembly"): string {
  return chamber ? `(${term}) AND chamber:${chamber.toUpperCase()}` : term;
}

export async function searchMembers(
  apiKey: ApiKey,
  term: string,
  sessionYear?: number,
  chamber?: "senate" | "assembly",
  limit = 25,
  offset = 0
): Promise<PaginatedResult<Member>> {
  // `full=true` is documented ("Set to true to see the full member responses");
  // without it each row is a session-member summary with no fullName and no
  // chamber, which is what made a Senate-scoped answer unreadable (issue #17).
  // Observed live 2026-10-11: member search items are member objects directly,
  // not the generic { result, rank } search wrapper.
  const url = buildUrl(memberSearchPath(sessionYear), apiKey, {
    term: memberSearchTerm(term, chamber),
    full: "true",
    limit,
    offset,
  });
  return apiFetch<PaginatedResult<Member>>(url);
}
