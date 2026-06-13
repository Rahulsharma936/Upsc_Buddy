-- Migration: Evolve ai_notes for Phase 2C cognitive-compression model
-- Replaces old sections (summary, key_points, upsc_angle, memory_triggers)
-- with new structure (core_idea, exam_triggers, static_current_link,
-- answer_writing_angles, memory_hooks).

-- Drop old columns if they exist (safe for fresh installs)
ALTER TABLE ai_notes DROP COLUMN IF EXISTS summary;
ALTER TABLE ai_notes DROP COLUMN IF EXISTS key_points;
ALTER TABLE ai_notes DROP COLUMN IF EXISTS upsc_angle;
ALTER TABLE ai_notes DROP COLUMN IF EXISTS memory_triggers;

-- Add new structured columns
ALTER TABLE ai_notes
  ADD COLUMN IF NOT EXISTS core_idea TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS exam_triggers TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS static_current_link TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS answer_writing_angles TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS memory_hooks TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- Unique constraint: one version per concept
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_notes_concept_version_uniq'
  ) THEN
    ALTER TABLE ai_notes
      ADD CONSTRAINT ai_notes_concept_version_uniq UNIQUE (concept_id, version);
  END IF;
END $$;

-- Index for content hash dedup
CREATE INDEX IF NOT EXISTS idx_ai_notes_content_hash ON ai_notes(content_hash);
