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

// ─── Citation links (issue #18) ───────────────────────────────────────────────

/**
 * Doc types whose nysenate.gov URL shape was confirmed in a browser on
 * 2026-08-02: https://www.nysenate.gov/legislation/laws/{lawId}/{locationId},
 * e.g. EDN/6233, PBO/86, STT/103 (SECTION) and EDN/A125 (ARTICLE).
 * CHAPTER and TITLE were not checked, so they get null rather than a guess.
 * Don't "fix" that by adding them here without opening one in a browser:
 * www.nysenate.gov returns 403 to curl, so a command-line check proves nothing.
 */
const LINKABLE_DOC_TYPES = new Set(["SECTION", "ARTICLE"]);

/** A link a person can open, or null when this server cannot vouch for one. */
export function nysenateLawUrl(doc: { lawId?: unknown; locationId?: unknown; docType?: unknown }): string | null {
  const { lawId, locationId, docType } = doc;
  if (typeof lawId !== "string" || typeof locationId !== "string" || typeof docType !== "string") return null;
  if (!LINKABLE_DOC_TYPES.has(docType)) return null;
  return `https://www.nysenate.gov/legislation/laws/${encodeURIComponent(lawId)}/${encodeURIComponent(locationId)}`;
}

export function withNysenateUrl<T extends object>(doc: T): T & { nysenate_url: string | null } {
  return { ...doc, nysenate_url: nysenateLawUrl(doc) };
}

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
): Promise<LawDocument & { nysenate_url: string | null }> {
  const url = buildUrl(`/laws/${lawId}/${locationId}`, apiKey);
  return withNysenateUrl(await apiFetch<LawDocument>(url));
}
