/**
 * How current each kind of data in the local copy is.
 *
 * The nightly sync (scripts/sync.js) reads the API's updates feed and refreshes only bills,
 * agendas and calendars; its time is sync_state.last_synced_at. Laws, members, committees and
 * transcripts change in the copy only when scripts/fetch-data.js downloads them again, so the
 * sync time says nothing about them. fetch-data.js records, per type, when it last downloaded
 * that type, as sync_state.fetched_at_<type> (with its New York offset). A copy downloaded by an
 * older version has no such time: its answers then say the date is not recorded and that the
 * data comes from the last full download. No date is guessed.
 */
import { getSyncState } from "./db.js";
import { syncedAtWithZone } from "./syncTime.js";

/** The kinds of data in the local copy, as fetch-data.js's --types names them. */
export type CorpusType = "bills" | "agendas" | "calendars" | "laws" | "members" | "committees" | "transcripts";

/** The types the nightly sync refreshes (scripts/sync.js: the BILL, AGENDA and CALENDAR branches). */
export const SYNCED_TYPES: ReadonlySet<CorpusType> = new Set(["bills", "agendas", "calendars"]);

/** The sync_state key fetch-data.js writes when it has downloaded a type. */
export const fetchedAtKey = (type: CorpusType): string => `fetched_at_${type}`;

export interface CorpusDate {
  type: CorpusType;
  /** The date for provenance() (zoned), or null when none is recorded. */
  asOf: string | null;
  /** The words inside "local corpus (…)". */
  words: string;
  /** A sentence for the answer's footer when the date is not the sync time; null for synced types. */
  note: string | null;
  /** What refreshes this type. */
  refresh: string;
}

/** The date of one type of local data, from a sync_state table (null when unreadable). */
export function corpusDate(type: CorpusType, state: Record<string, string> | null): CorpusDate {
  if (SYNCED_TYPES.has(type)) {
    const asOf = syncedAtWithZone(state?.last_synced_at);
    return { type, asOf, words: `synced ${asOf ?? "unknown date"}`, note: null, refresh: "re-run the sync (`npm run sync`)" };
  }
  const refresh = `download them again (\`npm run fetch-data -- --types=${type}\`)`;
  const asOf = syncedAtWithZone(state?.[fetchedAtKey(type)]);
  if (asOf) {
    return {
      type, asOf, refresh,
      words: `${type} downloaded ${asOf}; the nightly sync does not update ${type}`,
      note: `The nightly sync does not update ${type}: this copy of them was downloaded ${asOf}.`,
    };
  }
  return {
    type, asOf: null, refresh,
    words: `date of these ${type} not recorded; they come from the last full download, not the nightly sync`,
    note: `The local copy does not record when its ${type} were downloaded. They come from the last full ` +
      "download (scripts/fetch-data.js), not the nightly sync, so the sync time does not apply to them.",
  };
}

/** corpusDate for this process's local copy. Never fails a request over a date. */
export async function corpusDateFor(type: CorpusType): Promise<CorpusDate> {
  let state: Record<string, string> | null = null;
  try {
    state = await getSyncState();
  } catch {
    state = null;
  }
  return corpusDate(type, state);
}

/** The local copy's "How current" for about_data, per data type: the sync time (as the shared
 * module reported it) only for the types the sync refreshes, and each other type's own download
 * date, or that it is not recorded. */
export function typeDatesSentence(syncAsOf: string, state: Record<string, string> | null): string {
  const others = (["laws", "members", "committees", "transcripts"] as const).map((t) => {
    const d = corpusDate(t, state);
    return `${t}: ${d.asOf ? `downloaded ${d.asOf}` : "not recorded (from the last full download)"}`;
  });
  return `bills, agendas and calendars: ${syncAsOf} (the last sync; only these are synced). ` +
    `The sync does not update the rest; ${others.join("; ")}`;
}

type AboutDataResult = {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: { sources?: Array<{ topic?: string; title?: string; as_of?: string }> } & Record<string, unknown>;
  isError?: boolean;
};

/** about_data's answer with the local copy's "How current on this server" given per data type
 * (typeDatesSentence), in the text and in structuredContent's as_of. The shared module's
 * freshness hook takes one date only, so the server rewrites that one line. A copy that is not
 * available on this server is left as the module reports it. */
export async function withTypeDates<R extends AboutDataResult>(result: R): Promise<R> {
  const corpus = result.structuredContent?.sources?.find((s) => s.topic === "corpus");
  if (result.isError || !corpus || typeof corpus.as_of !== "string" || corpus.as_of.startsWith("not available on this server")) {
    return result;
  }
  let state: Record<string, string> | null = null;
  try {
    state = await getSyncState();
  } catch {
    state = null;
  }
  const before = corpus.as_of;
  const after = typeDatesSentence(before, state);
  const head = `${corpus.title} [topic: corpus]`;
  const content = result.content.map((c) => {
    if (c.type !== "text" || typeof c.text !== "string") return c;
    const blocks = c.text.split("\n\n").map((b) =>
      b.startsWith(head) ? b.replace(`How current on this server: ${before}`, `How current on this server: ${after}`) : b);
    return { ...c, text: blocks.join("\n\n") };
  });
  const sources = result.structuredContent!.sources!.map((s) => (s === corpus ? { ...s, as_of: after } : s));
  return { ...result, content, structuredContent: { ...result.structuredContent, sources } };
}
