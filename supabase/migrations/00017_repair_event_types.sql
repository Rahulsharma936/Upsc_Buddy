-- ============================================================================
-- Migration 00017: Allow repair evidence event types
-- ============================================================================
-- R3.3 (repair verification) and the post-repair understanding step append
-- `repair_verification` and `repair_understanding` rows to revision_events.
-- Migration 00015 created the table with a CHECK constraint that only permits
-- the four original event types, so every repair evidence insert has been
-- rejected by the database since R3.3 shipped (the UI degraded silently with
-- "Couldn't save this result"). Found by scripts/e2e-student-session.ts.
--
-- This widens the constraint. No columns, tables or defaults change.
-- Safe to re-run.
-- ============================================================================

ALTER TABLE revision_events
  DROP CONSTRAINT IF EXISTS revision_events_event_type_check;

ALTER TABLE revision_events
  ADD CONSTRAINT revision_events_event_type_check
  CHECK (event_type IN (
    'review',
    'mcq_attempt',
    'skip',
    'self_assessment',
    'repair_verification',
    'repair_understanding'
  ));

COMMENT ON CONSTRAINT revision_events_event_type_check ON revision_events IS
  'Allowed evidence event types. repair_* added in 00017 (R3.3 evidence was being rejected).';
