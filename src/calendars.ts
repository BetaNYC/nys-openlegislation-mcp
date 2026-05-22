import { apiFetch, buildUrl, type PaginatedResult } from "./api.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CalendarEntry = {
  calendarNo: number;
  year: number;
  calDate: string;
  releaseDateTime: string;
  activeLists: { items: ActiveList[]; size: number };
  supplementalCalendars: { items: SupplementalCalendar[]; size: number };
};

export type ActiveList = {
  sequenceNo: number;
  calDate: string;
  releaseDateTime: string;
  notes: string;
  totalEntryCount: number;
  entries: {
    items: Array<{
      billCalNo: number;
      basePrintNo: string;
      session: number;
      subBillPrintNo: string | null;
      billHigh: boolean;
    }>;
    size: number;
  };
};

export type SupplementalCalendar = {
  version: string;
  calDate: string;
  releaseDateTime: string;
  sections: {
    items: Array<{
      type: string;
      entries: {
        items: Array<{
          billCalNo: number;
          basePrintNo: string;
          session: number;
          subBillPrintNo: string | null;
          billHigh: boolean;
        }>;
        size: number;
      };
    }>;
    size: number;
  };
};

// ─── API functions ────────────────────────────────────────────────────────────

export async function listCalendars(
  apiKey: string,
  year: number,
  limit = 50,
  offset = 0
): Promise<PaginatedResult<CalendarEntry>> {
  const url = buildUrl(`/calendars/${year}`, apiKey, { limit, offset });
  return apiFetch<PaginatedResult<CalendarEntry>>(url);
}

export async function getCalendar(
  apiKey: string,
  year: number,
  calendarNo: number
): Promise<CalendarEntry> {
  const url = buildUrl(`/calendars/${year}/${calendarNo}`, apiKey);
  return apiFetch<CalendarEntry>(url);
}
