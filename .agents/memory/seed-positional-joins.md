---
name: Seeds must join data sources by name and upserts must repair links
description: positional joins between seed data sources silently mis-link rows; name-only upserts freeze stale FK links across reseeds
---

Two invariants for any seed that walks two data sources in parallel:

1. **Join by name, never by position.** Array-order joins silently mis-link every downstream row the day the two sources disagree on order. Match on a normalized name and hard-fail on no match — a mismatch is a data bug, not something to skip.
2. **Upsert conflict-sets must include FK link columns.** An upsert that only refreshes `name` preserves stale parent links forever, and later reseeds never repair them. Update the link columns on conflict, and explicitly re-sync denormalized copies of those links in child tables.

**Why:** the geography seed violated both — a positional join plus name-only upserts left the live DB with most wards linked to the wrong county/constituency long after the source data was corrected.

**How to apply:** review any new seed walk for positional joins, and any upsert for name-only conflict-sets, before running it against a database with existing rows.
