// scripts/lib/ny-time.js
//
// Times for the Open Legislation update ranges and the corpus watermark (2.7.0).
//
// The API reads every date and time as New York local time written with no offset, and an
// offset it is sent is ignored, not converted: "2026-10-20T18:30:00Z means 6:30 p.m. in New
// York" (https://legislation.nysenate.gov/static/docs/html/conventions.html, "Dates and
// times"). "Keeping Up with Changes" (keeping_up.html) says to end each range at New York now
// minus 2 minutes, to send the saved end as the next range's start, and to note that time
// before an initial load, not after it.
//
// Before 2.7.0, sync.js and fetch-data.js sent and stored new Date().toISOString().split(".")[0]:
// the UTC time with its Z cut off. The API read it as New York time, four or five hours late,
// so each range ended in the future and the next one skipped the changes made in between.
//
// The watermark (sync_state.last_synced_at) is now stored with its New York offset, such as
// 2026-11-13T16:58:00-05:00, so it is one exact instant. A value with no zone can only have
// been written by an older version, so it is read as UTC, which is what it was.
//
// Side-effect-free, so it is unit-tested hermetically (test/sync-time.test.js).

const NY = "America/New_York";
const FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: NY,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const ZONED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const UNMARKED = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})$/;
const WALL = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/;

/** The New York wall time of an instant, as the API wants it: YYYY-MM-DDTHH:MM:SS, no offset. */
export function nyWallTime(date) {
  const p = Object.fromEntries(FMT.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/** New York's UTC offset at an instant: "-05:00" (EST) or "-04:00" (EDT). */
export function nyOffset(date) {
  const whole = new Date(Math.floor(date.getTime() / 1000) * 1000);
  const minutes = Math.round((Date.parse(`${nyWallTime(whole)}Z`) - whole.getTime()) / 60000);
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** How the watermark is stored: New York wall time with its offset, one exact instant. */
export function nyStamp(date) {
  return `${nyWallTime(date)}${nyOffset(date)}`;
}

/** A stored watermark as an instant. Zoned: that instant. Unmarked: an older version's UTC. */
export function parseStoredSyncTime(value) {
  if (typeof value !== "string") return null;
  if (ZONED.test(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = UNMARKED.exec(value);
  if (m) {
    const d = new Date(`${m[1]}T${m[2]}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** The end of a range that starts now: New York now minus 2 minutes (keeping_up.html). */
export function rangeEnd(now = new Date()) {
  return new Date(now.getTime() - 2 * 60 * 1000);
}

/**
 * The `from` to send, as New York wall time. --from follows the API's own convention (New York
 * local time, no offset) and is sent as given; with a zone it is converted. Otherwise the stored
 * watermark is converted from the instant it records.
 */
export function resolveFrom(override, stored) {
  if (override !== undefined && override !== null) {
    if (ZONED.test(override)) return nyWallTime(new Date(override));
    if (WALL.test(override)) return override.replace(" ", "T");
    throw new Error(`--from must be a New York date and time, YYYY-MM-DDTHH:MM:SS (got ${JSON.stringify(override)})`);
  }
  if (!stored) throw new Error("No last_synced_at found in sync_state. Run fetch-data.js first.");
  const instant = parseStoredSyncTime(stored);
  if (!instant) throw new Error(`last_synced_at cannot be read as a time (${JSON.stringify(stored)}); re-run with --from=YYYY-MM-DDTHH:MM:SS`);
  return nyWallTime(instant);
}

/**
 * The watermark an initial load (fetch-data.js) leaves. The first load stores the time noted
 * before it started. A later load, often only some types (--types=committees), keeps the
 * existing watermark: moving it forward would make the next sync skip changes to everything
 * the load did not fetch. Starting the next sync earlier only fetches some items again, which
 * is harmless.
 */
export function initialWatermark(existing, loadStart) {
  return existing ? existing : nyStamp(loadStart);
}
