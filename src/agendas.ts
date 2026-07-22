import { apiFetch, buildUrl, type ApiKey, type PaginatedResult } from "./api.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgendaId = {
  number: number;
  year: number;
};

export type AgendaCommitteeAttendance = {
  committeeName: string;
  committeeChamberId: string;
  meetingDateTime: string;
  location: string;
  notes: string;
  quorum: number;
  attendList: Array<{
    memberId: number;
    shortName: string;
    fullName: string;
    rank: number;
    party: string;
    attend: boolean;
  }>;
};

export type AgendaBillEntry = {
  basePrintNo: string;
  session: number;
  billHigh: boolean;
  message: string;
  addedDate: string | null;
  removedFromAgenda: boolean;
  vote: {
    voteType: string;
    voteDate: string;
    memberVotes: Record<string, unknown>;
    committee: { chamber: string; name: string };
  } | null;
};

export type AgendaCommitteeItem = {
  committeeId: { name: string; chamber: string };
  meeting: AgendaCommitteeAttendance;
  bills: { items: AgendaBillEntry[]; size: number };
  hasVotes: boolean;
};

export type Agenda = {
  id: AgendaId;
  weekOf: string;
  publishedDateTime: string;
  committeeAgendas: { items: AgendaCommitteeItem[]; size: number };
};

// ─── API functions ────────────────────────────────────────────────────────────

export async function listAgendas(
  apiKey: ApiKey,
  year: number,
  limit = 50,
  offset = 0
): Promise<PaginatedResult<Agenda>> {
  const url = buildUrl(`/agendas/${year}`, apiKey, { limit, offset });
  return apiFetch<PaginatedResult<Agenda>>(url);
}

export async function getAgenda(
  apiKey: ApiKey,
  year: number,
  agendaNo: number
): Promise<Agenda> {
  const url = buildUrl(`/agendas/${year}/${agendaNo}`, apiKey);
  return apiFetch<Agenda>(url);
}
