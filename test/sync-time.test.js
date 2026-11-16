// The local copy's sync time (2.7.0). The Senate's API reads every date and time as New York
// local time written with no offset, and ignores an offset if one is sent ("API Conventions",
// "Dates and times"; "Keeping Up with Changes": end each range at New York now minus 2 minutes,
// and note that time before an initial load). Until 2.7.0, scripts/sync.js and
// scripts/fetch-data.js sent and stored the UTC time with its Z cut off, so each sync's range
// ended four or five hours in the future and the next sync skipped the changes made in that
// window. These tests pin the conversion, both seasons of daylight saving time, how a value
// stored by an older version is read (UTC, because that is what it was), and the readers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  nyWallTime,
  nyOffset,
  nyStamp,
  parseStoredSyncTime,
  rangeEnd,
  resolveFrom,
  initialWatermark,
} from "../scripts/lib/ny-time.js";
import { syncedAtWithZone } from "../dist/syncTime.js";

const at = (iso) => new Date(iso);

test("New York wall time and offset, in winter (EST) and summer (EDT)", () => {
  assert.equal(nyWallTime(at("2026-01-15T17:00:00Z")), "2026-01-15T12:00:00");
  assert.equal(nyOffset(at("2026-01-15T17:00:00Z")), "-05:00");
  assert.equal(nyWallTime(at("2026-07-15T17:00:00Z")), "2026-07-15T13:00:00");
  assert.equal(nyOffset(at("2026-07-15T17:00:00Z")), "-04:00");
  assert.equal(nyWallTime(at("2026-11-14T04:59:59Z")), "2026-11-13T23:59:59", "the New York date, not the UTC date");
  assert.equal(nyWallTime(at("2026-11-14T05:00:00Z")), "2026-11-14T00:00:00", "midnight is 00, never 24");
});

test("across the daylight saving changes, the offset follows the instant", () => {
  // 2026-03-08: 2:00 a.m. EST becomes 3:00 a.m. EDT (07:00Z).
  assert.equal(nyStamp(at("2026-03-08T06:59:59Z")), "2026-03-08T01:59:59-05:00");
  assert.equal(nyStamp(at("2026-03-08T07:00:00Z")), "2026-03-08T03:00:00-04:00");
  // 2026-11-01: 2:00 a.m. EDT becomes 1:00 a.m. EST (06:00Z); 1:30 happens twice.
  assert.equal(nyStamp(at("2026-11-01T05:30:00Z")), "2026-11-01T01:30:00-04:00");
  assert.equal(nyStamp(at("2026-11-01T06:30:00Z")), "2026-11-01T01:30:00-05:00");
  // A stored stamp reads back as the same instant, even in the repeated hour.
  for (const iso of ["2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z", "2026-03-08T07:00:00Z", "2026-07-15T17:00:00Z"]) {
    assert.equal(parseStoredSyncTime(nyStamp(at(iso))).toISOString(), at(iso).toISOString(), iso);
  }
});

test("a range ends at New York now minus 2 minutes, sent with no offset", () => {
  const end = rangeEnd(at("2026-11-13T22:00:00Z"));
  assert.equal(end.toISOString(), "2026-11-13T21:58:00.000Z");
  assert.equal(nyWallTime(end), "2026-11-13T16:58:00");
});

test("a stored time with a zone is that instant; an unmarked one is from an older version, so UTC", () => {
  assert.equal(parseStoredSyncTime("2026-11-13T16:58:00-05:00").toISOString(), "2026-11-13T21:58:00.000Z");
  assert.equal(parseStoredSyncTime("2026-11-13T21:58:00Z").toISOString(), "2026-11-13T21:58:00.000Z");
  // Written by toISOString().split(".")[0] before 2.7.0: UTC with the Z cut off.
  assert.equal(parseStoredSyncTime("2026-10-22T04:00:00").toISOString(), "2026-10-22T04:00:00.000Z");
  assert.equal(parseStoredSyncTime("2026-10-22 04:00:00").toISOString(), "2026-10-22T04:00:00.000Z");
  assert.equal(parseStoredSyncTime("yesterday"), null);
  assert.equal(parseStoredSyncTime(undefined), null);
});

test("the next sync starts where the last one really ended, in New York time", () => {
  // An old corpus: last synced at 04:00 UTC, which is midnight in New York (EDT). The old code
  // sent "2026-10-22T04:00:00", which the API read as 4 a.m. New York: four hours late.
  assert.equal(resolveFrom(undefined, "2026-10-22T04:00:00"), "2026-10-22T00:00:00");
  // A corpus synced by 2.7.0 or later.
  assert.equal(resolveFrom(undefined, "2026-11-13T16:58:00-05:00"), "2026-11-13T16:58:00");
  // --from is the API's own convention, New York local time; with a zone it is converted.
  assert.equal(resolveFrom("2026-11-01T09:00:00", "2026-11-13T16:58:00-05:00"), "2026-11-01T09:00:00");
  assert.equal(resolveFrom("2026-11-01T14:00:00Z", undefined), "2026-11-01T09:00:00");
  assert.throws(() => resolveFrom(undefined, undefined), /No last_synced_at/);
  assert.throws(() => resolveFrom(undefined, "garbage"), /cannot be read/);
  assert.throws(() => resolveFrom("next tuesday", undefined), /--from/);
});

test("an initial load never moves an existing watermark forward", () => {
  const start = at("2026-11-13T21:58:00Z");
  assert.equal(initialWatermark(undefined, start), "2026-11-13T16:58:00-05:00", "first load: the time noted before it");
  assert.equal(initialWatermark("2026-10-22T04:00:00", start), "2026-10-22T04:00:00", "a later partial load keeps the old one");
  assert.equal(initialWatermark("2026-11-01T10:00:00-05:00", start), "2026-11-01T10:00:00-05:00");
});

test("the scripts no longer send or store a UTC time with its zone cut off", () => {
  for (const f of ["scripts/sync.js", "scripts/fetch-data.js"]) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /toISOString\(\)\.split\("\."\)\[0\]/, f);
    assert.match(src, /from "\.\/lib\/ny-time\.js"/, f);
  }
});

test("readers: the sync time is shown with its zone, old values as UTC", () => {
  assert.equal(syncedAtWithZone("2026-10-22T04:00:00"), "2026-10-22T04:00:00Z");
  assert.equal(syncedAtWithZone("2026-10-22 04:00:00"), "2026-10-22T04:00:00Z");
  assert.equal(syncedAtWithZone("2026-11-13T16:58:00-05:00"), "2026-11-13T16:58:00-05:00");
  assert.equal(syncedAtWithZone("2026-11-13T21:58:00Z"), "2026-11-13T21:58:00Z");
  assert.equal(syncedAtWithZone("not a time"), "not a time", "passed on, so about_data reports it unreadable");
  assert.equal(syncedAtWithZone(""), null);
  assert.equal(syncedAtWithZone(undefined), null);
});
