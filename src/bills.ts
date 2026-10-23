import { apiFetch, buildUrl, type ApiKey, withBillUrl, type PaginatedResult } from "./api.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BillSponsor = {
  memberId: number;
  shortName: string;
  sessionYear: number;
  chamber: string;
  incumbent: boolean;
  fullName: string;
  districtCode: number;
};

export type BillAmendment = {
  version: string;
  publishDate: string;
  sameAs: Record<string, unknown>;
  memo: string;
  lawSection: string;
  lawCode: string;
  actClause: string;
};

export type BillVote = {
  voteType: string;
  voteDate: string;
  committee: {
    chamber: string;
    name: string;
  };
  memberVotes: Record<string, unknown>;
};

export type Bill = {
  basePrintNo: string;
  session: number;
  basePrintNoStr: string;
  printNo: string;
  billType: {
    chamber: string;
    desc: string;
    resolution: boolean;
  };
  title: string;
  activeVersion: string;
  year: number;
  publishedDateTime: string;
  substitutedBy: unknown;
  sponsor: BillSponsor | null;
  summary: string;
  signed: boolean;
  adopted: boolean;
  vetoed: boolean;
  status: {
    statusType: string;
    statusDesc: string;
    actionDate: string;
    committeeName: string | null;
    billCalNo: number | null;
  };
  milestones: unknown;
  actions: unknown[];
  amendments: { items: Record<string, BillAmendment>; size: number };
  votes: { items: BillVote[]; size: number };
  vetoMessages: unknown[];
  approvalMessage: unknown;
  additionalSponsors: BillSponsor[];
  pastCommittees: unknown[];
  previousVersions: unknown[];
  coSponsors: unknown;
  multiSponsors: unknown;
  uniBill: boolean;
  programInfo: unknown;
};

// ─── API functions ────────────────────────────────────────────────────────────

/** Bill search route, scoped to one session year when given (issue #21). */
export function billSearchPath(sessionYear?: number): string {
  return sessionYear ? `/bills/${sessionYear}/search` : "/bills/search";
}

export async function getBill(
  apiKey: ApiKey,
  sessionYear: number,
  printNo: string
): Promise<Bill & { url: string }> {
  const url = buildUrl(`/bills/${sessionYear}/${printNo}`, apiKey);
  const bill = await apiFetch<Bill>(url);
  return withBillUrl(bill, sessionYear);
}

export async function searchBills(
  apiKey: ApiKey,
  term: string,
  sessionYear?: number,
  limit = 25,
  offset = 0
): Promise<PaginatedResult<{ result: Bill & { url: string }; rank: number }>> {
  // The session year goes in the PATH, not a query param (issue #21):
  //   (GET) /api/3/bills/search?term=...               across all session years
  //   (GET) /api/3/bills/{sessionYear}/search?term=... within one session year
  // https://legislation.nysenate.gov/static/docs/html/bills.html#search-for-bills
  // A `session` query param is not documented and is silently ignored upstream.
  const url = buildUrl(billSearchPath(sessionYear), apiKey, { term, limit, offset });
  const result = await apiFetch<PaginatedResult<{ result: Bill; rank: number }>>(url);
  return {
    ...result,
    items: result.items.map((item) => ({ ...item, result: withBillUrl(item.result) })),
  };
}

export async function listBills(
  apiKey: ApiKey,
  sessionYear: number,
  limit = 25,
  offset = 0
): Promise<PaginatedResult<Bill & { url: string }>> {
  const url = buildUrl(`/bills/${sessionYear}`, apiKey, { limit, offset });
  const result = await apiFetch<PaginatedResult<Bill>>(url);
  return {
    ...result,
    items: result.items.map((bill) => withBillUrl(bill, sessionYear)),
  };
}

/**
 * Votes for a bill.
 *
 * Open Legislation has no votes endpoint (issue #20: `/bills/{session}/{printNo}/votes`
 * is a 404). Votes are part of the bill response, under `result.votes`:
 * https://legislation.nysenate.gov/static/docs/html/bills.html#get-a-single-bill
 * `view=no_fulltext` is "identical to the default response except the full text
 * will be omitted", so it keeps the votes block and skips the heaviest field.
 */
export async function getBillVotes(
  apiKey: ApiKey,
  sessionYear: number,
  printNo: string
): Promise<{ items: BillVote[]; size: number }> {
  const url = buildUrl(`/bills/${sessionYear}/${printNo}`, apiKey, { view: "no_fulltext" });
  const bill = await apiFetch<Bill>(url);
  // The docs say votes appear "if there are any"; normalize absence to empty.
  return bill.votes ?? { items: [], size: 0 };
}
