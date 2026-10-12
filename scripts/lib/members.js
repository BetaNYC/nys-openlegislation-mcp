/**
 * Member full-name backfill for the local corpus (issue #17).
 *
 * The members table is filled from the member LIST endpoint
 * (/api/3/members/{sessionYear}/{chamber}), whose default summary rows carry
 * shortName and districtCode but no fullName:
 * https://legislation.nysenate.gov/static/docs/html/members.html#get-a-list-of-members
 *
 * Every bill response, though, carries its sponsor as
 * `sponsor.member.{memberId, shortName, sessionYear, fullName, districtCode}`
 * (https://legislation.nysenate.gov/static/docs/html/bills.html#get-a-single-bill),
 * and the corpus already stores every bill's raw JSON. So names are recovered
 * from data already on disk: no network calls.
 *
 * Idempotent: only rows whose full_name is NULL are touched. The bill scan is
 * skipped only when no row is NULL. Members who have never prime-sponsored a
 * bill stay NULL, so in practice the scan (about 2s on the full corpus) re-runs
 * on most syncs; that is cheap enough not to track which rows were tried.
 */

/** Add members.full_name to an older corpus. Cheap and safe to re-run. */
export function ensureMemberFullNameColumn(db) {
  const cols = db.prepare("PRAGMA table_info(members)").all().map((c) => c.name);
  if (!cols.includes("full_name")) {
    db.exec("ALTER TABLE members ADD COLUMN full_name TEXT");
  }
}

/**
 * Fill members.full_name from bill sponsor blocks. Returns
 * `{ filled, missing }`: rows updated this run, and rows still NULL (a member
 * who has never been a prime sponsor of a bill in the corpus).
 */
export function backfillMemberFullNames(db) {
  ensureMemberFullNameColumn(db);
  const pending = db.prepare("SELECT count(*) AS n FROM members WHERE full_name IS NULL").get().n;
  if (pending === 0) return { filled: 0, missing: 0 };

  // One pass over bills. Where a member's name differs across sessions, the
  // most recent session wins: SQLite returns bare columns from the row that
  // supplied max() (https://sqlite.org/lang_select.html#bareagg).
  const filled = db.transaction(() => {
    db.exec(`
      DROP TABLE IF EXISTS temp.sponsor_names;
      CREATE TEMP TABLE sponsor_names AS
        SELECT member_id, full_name FROM (
          SELECT json_extract(raw_json, '$.sponsor.member.memberId') AS member_id,
                 json_extract(raw_json, '$.sponsor.member.fullName') AS full_name,
                 max(session_year) AS latest
          FROM bills
          WHERE json_extract(raw_json, '$.sponsor.member.fullName') IS NOT NULL
          GROUP BY member_id
        );
    `);
    const res = db
      .prepare(`
        UPDATE members
        SET full_name = (SELECT s.full_name FROM temp.sponsor_names s WHERE s.member_id = members.member_id)
        WHERE full_name IS NULL
          AND member_id IN (SELECT member_id FROM temp.sponsor_names)
      `)
      .run();
    db.exec("DROP TABLE temp.sponsor_names");
    return res.changes;
  })();

  const missing = db.prepare("SELECT count(*) AS n FROM members WHERE full_name IS NULL").get().n;
  return { filled, missing };
}
