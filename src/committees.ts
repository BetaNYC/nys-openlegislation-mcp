import { apiFetch, buildUrl, type ApiKey, type PaginatedResult } from "./api.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Committee = {
  chamber: string;
  name: string;
  sessionYear: number;
  reformed: boolean;
  chair: {
    memberId: number;
    shortName: string;
    fullName: string;
    districtCode: number;
  } | null;
  meetDay: string | null;
  meetTime: string | null;
  meetAltWeek: boolean;
  meetAltWeekText: string | null;
  location: string | null;
  subcommittees: string[];
  parentCommittee: { name: string; chamber: string } | null;
};

export type CommitteeMeeting = {
  committeeName: string;
  committeeChamberId: string;
  agendaNo: number;
  year: number;
  meetingDateTime: string;
  location: string;
  notes: string;
  bills: { items: Array<{ basePrintNo: string; session: number; title: string }>; size: number };
};

// ─── API functions ────────────────────────────────────────────────────────────

export async function listCommittees(
  apiKey: ApiKey,
  sessionYear: number,
  chamber: "senate" | "assembly",
  limit = 100,
  offset = 0
): Promise<PaginatedResult<Committee>> {
  const url = buildUrl(`/committees/${sessionYear}/${chamber}`, apiKey, {
    limit,
    offset,
  });
  return apiFetch<PaginatedResult<Committee>>(url);
}

export async function getCommittee(
  apiKey: ApiKey,
  sessionYear: number,
  chamber: "senate" | "assembly",
  committeeName: string
): Promise<Committee> {
  const url = buildUrl(
    `/committees/${sessionYear}/${chamber}/${encodeURIComponent(committeeName)}`,
    apiKey
  );
  return apiFetch<Committee>(url);
}

export async function getCommitteeMeetings(
  apiKey: ApiKey,
  sessionYear: number,
  chamber: "senate" | "assembly",
  committeeName: string,
  limit = 25,
  offset = 0
): Promise<PaginatedResult<CommitteeMeeting>> {
  const url = buildUrl(
    `/committees/${sessionYear}/${chamber}/${encodeURIComponent(committeeName)}/meetings`,
    apiKey,
    { limit, offset }
  );
  return apiFetch<PaginatedResult<CommitteeMeeting>>(url);
}
