-- Migration: Evolve concepts table for Phase 2B
-- Adds normalized_name, display_name, extraction_metadata,
-- and a unique constraint for deduplication.

-- Add new columns
ALTER TABLE concepts
  ADD COLUMN IF NOT EXISTS normalized_name TEXT,
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS extraction_metadata JSONB NOT NULL DEFAULT '{}';

-- Backfill: set normalized_name and display_name from existing name
UPDATE concepts
SET
  normalized_name = LOWER(TRIM(name)),
  display_name = TRIM(name)
WHERE normalized_name IS NULL;

-- Now make them NOT NULL
ALTER TABLE concepts
  ALTER COLUMN normalized_name SET NOT NULL,
  ALTER COLUMN display_name SET NOT NULL;

-- Replace the old name index with normalized_name index
DROP INDEX IF EXISTS concepts_name_idx;
CREATE INDEX IF NOT EXISTS idx_concepts_normalized_name ON concepts(normalized_name);

-- Add unique constraint: no duplicate concepts per user + log + normalized_name + subject
ALTER TABLE concepts
  ADD CONSTRAINT concepts_user_log_name_uniq
  UNIQUE (user_id, daily_log_id, normalized_name, subject);
