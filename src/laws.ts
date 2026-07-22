import { apiFetch, buildUrl, type ApiKey, type PaginatedResult } from "./api.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LawInfo = {
  lawId: string;
  name: string;
  lawType: string;
  chapter: string;
};

// A node in the law document tree. Confirmed live against
// GET /api/3/laws/{lawId} on 2026-07-07: node fields sit directly on the node
// (there is no `lawVersion` wrapper at this level), and child documents are
// nested under `documents` as a `{ items, size }` wrapper — NOT a `children`
// array.
export type LawTreeNode = {
  lawId: string;
  lawName: string;
  locationId: string;
  title: string;
  docType: string;
  docLevelId: string;
  activeDate: string;
  sequenceNo: number;
  repealedDate: string | null;
  fromSection: string | null;
  toSection: string | null;
  text: string | null;
  repealed: boolean;
  publishedDates: string[];
  documents: { items: LawTreeNode[]; size: number };
};

export type LawTree = {
  lawVersion: { lawId: string; activeDate: string };
  info: LawInfo;
  publishedDates: string[];
  documents: LawTreeNode;
};

export type LawDocument = {
  lawId: string;
  locationId: string;
  docType: string;
  docLevelId: string;
  docNumber: string;
  activeDate: string;
  sequenceNo: number;
  title: string;
  text: string;
  lawId2: string;
};

// ─── API functions ────────────────────────────────────────────────────────────

export async function listLaws(
  apiKey: ApiKey
): Promise<PaginatedResult<LawInfo>> {
  const url = buildUrl("/laws", apiKey, { limit: 200 });
  return apiFetch<PaginatedResult<LawInfo>>(url);
}

export async function getLawTree(
  apiKey: ApiKey,
  lawId: string
): Promise<LawTree> {
  const url = buildUrl(`/laws/${lawId}`, apiKey);
  return apiFetch<LawTree>(url);
}

export async function getLawSection(
  apiKey: ApiKey,
  lawId: string,
  locationId: string
): Promise<LawDocument> {
  const url = buildUrl(`/laws/${lawId}/${locationId}`, apiKey);
  return apiFetch<LawDocument>(url);
}
