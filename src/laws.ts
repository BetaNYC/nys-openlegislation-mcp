import { apiFetch, buildUrl, type PaginatedResult } from "./api.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LawInfo = {
  lawId: string;
  name: string;
  lawType: string;
  chapter: string;
};

export type LawTreeNode = {
  lawVersion: {
    lawId: string;
    locationId: string;
    docType: string;
    docLevelId: string;
    docNumber: string;
    activeDate: string;
    sequenceNo: number;
    title: string;
    fromSection: string | null;
    toSection: string | null;
    text: string;
    lawId2: string;
  };
  children?: LawTreeNode[];
};

export type LawTree = {
  info: LawInfo;
  documents: LawTreeNode;
  publishedDate: string;
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
  apiKey: string
): Promise<PaginatedResult<LawInfo>> {
  const url = buildUrl("/laws", apiKey, { limit: 200 });
  return apiFetch<PaginatedResult<LawInfo>>(url);
}

export async function getLawTree(
  apiKey: string,
  lawId: string
): Promise<LawTree> {
  const url = buildUrl(`/laws/${lawId}`, apiKey);
  return apiFetch<LawTree>(url);
}

export async function getLawSection(
  apiKey: string,
  lawId: string,
  locationId: string
): Promise<LawDocument> {
  const url = buildUrl(`/laws/${lawId}/${locationId}`, apiKey);
  return apiFetch<LawDocument>(url);
}
