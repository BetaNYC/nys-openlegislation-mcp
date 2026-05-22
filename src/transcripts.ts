import { apiFetch, buildUrl, type PaginatedResult } from "./api.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FloorTranscript = {
  dateTime: string;
  sessionType: string;
  text: string;
  filename: string;
};

export type HearingTranscript = {
  filename: string;
  date: string;
  title: string;
  address: string;
  text: string;
};

// ─── API functions ────────────────────────────────────────────────────────────

export async function listFloorTranscripts(
  apiKey: string,
  year: number,
  limit = 50,
  offset = 0
): Promise<PaginatedResult<FloorTranscript>> {
  const url = buildUrl(`/transcripts/floor/${year}`, apiKey, { limit, offset });
  return apiFetch<PaginatedResult<FloorTranscript>>(url);
}

export async function getFloorTranscript(
  apiKey: string,
  dateTime: string
): Promise<FloorTranscript> {
  // dateTime format: ISO-8601, e.g. "2025-01-15T10:30:00"
  const url = buildUrl(`/transcripts/floor/${encodeURIComponent(dateTime)}`, apiKey);
  return apiFetch<FloorTranscript>(url);
}

export async function listHearingTranscripts(
  apiKey: string,
  year: number,
  limit = 50,
  offset = 0
): Promise<PaginatedResult<HearingTranscript>> {
  const url = buildUrl(`/transcripts/hearing/${year}`, apiKey, { limit, offset });
  return apiFetch<PaginatedResult<HearingTranscript>>(url);
}

export async function getHearingTranscript(
  apiKey: string,
  filename: string
): Promise<HearingTranscript> {
  const url = buildUrl(`/transcripts/hearing/${encodeURIComponent(filename)}`, apiKey);
  return apiFetch<HearingTranscript>(url);
}
