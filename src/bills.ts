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

export type BillUpdate = {
  id: {
    basePrintNo: string;
    session: number;
  };
  contentType: string;
  lastFragment: {
    type: string;
    text: string;
    date: string;
  };
};

// ─── API functions ────────────────────────────────────────────────────────────

export async function getBill(
  apiKey: ApiKey,
  sessionYear: number,
  printNo: string,
  fullText = false
): Promise<Bill & { url: string }> {
  const url = buildUrl(`/bills/${sessionYear}/${printNo}`, apiKey, {
    ...(fullText ? { view: "with_refs_no_fulltext" } : {}),
  });
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
  const params: Record<string, string | number> = { term, limit, offset };
  if (sessionYear) {
    params.session = sessionYear;
  }
  const url = buildUrl("/bills/search", apiKey, params);
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

export async function getBillVotes(
  apiKey: ApiKey,
  sessionYear: number,
  printNo: string
): Promise<{ items: BillVote[]; size: number }> {
  const url = buildUrl(`/bills/${sessionYear}/${printNo}/votes`, apiKey);
  return apiFetch<{ items: BillVote[]; size: number }>(url);
}

export async function getBillUpdates(
  apiKey: ApiKey,
  from: string,
  to: string,
  limit = 50,
  offset = 0
): Promise<PaginatedResult<BillUpdate>> {
  const url = buildUrl(`/bills/updates/${from}/${to}`, apiKey, {
    limit,
    offset,
    order: "desc",
  });
  return apiFetch<PaginatedResult<BillUpdate>>(url);
}
