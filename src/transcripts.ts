import { apiFetch, buildUrl, type PaginatedResult } from "./api.js";

// ─── API functions ────────────────────────────────────────────────────────────

export async function listFloorTranscripts(
  apiKey: string,
  year: number,
  limit = 50,
  offset = 0
): Promise<unknown> {
  const url = buildUrl(`/transcripts/floor/${year}`, apiKey, { limit, offset });
  return apiFetch<PaginatedResult<unknown>>(url);
}

export async function getFloorTranscript(
  apiKey: string,
  dateTime: string
): Promise<unknown> {
  // dateTime format: ISO-8601, e.g. "2025-01-15T10:30:00"
  const url = buildUrl(`/transcripts/floor/${encodeURIComponent(dateTime)}`, apiKey);
  return apiFetch<unknown>(url);
}

export async function listHearingTranscripts(
  apiKey: string,
  year: number,
  limit = 50,
  offset = 0
): Promise<unknown> {
  const url = buildUrl(`/transcripts/hearing/${year}`, apiKey, { limit, offset });
  return apiFetch<PaginatedResult<unknown>>(url);
}

export async function getHearingTranscript(
  apiKey: string,
  filename: string
): Promise<unknown> {
  const url = buildUrl(`/transcripts/hearing/${encodeURIComponent(filename)}`, apiKey);
  return apiFetch<unknown>(url);
}
