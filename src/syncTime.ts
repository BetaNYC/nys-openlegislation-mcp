/**
 * The corpus's last sync time (sync_state.last_synced_at), shown with its zone.
 *
 * Since 2.7.0 the corpus scripts store it with its New York offset (scripts/lib/ny-time.js),
 * for example 2026-11-13T16:58:00-05:00, which is passed on as it is. Before 2.7.0 they stored
 * new Date().toISOString().split(".")[0], a UTC time with its Z cut off; such a value can only
 * be UTC, so its Z is put back. Anything else is passed on unchanged, never guessed, and
 * about_data reports it as unreadable.
 */
const ZONED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const UNMARKED = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})$/;

export function syncedAtWithZone(value: string | null | undefined): string | null {
  if (!value) return null;
  if (ZONED.test(value)) return value;
  const m = UNMARKED.exec(value);
  return m ? `${m[1]}T${m[2]}Z` : value;
}
