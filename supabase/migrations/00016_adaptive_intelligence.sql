-- Phase 4: Adaptive Intelligence Layer
-- Single computed-state table per user. All intelligence is derived
-- from existing data (mastery, events, concepts, mappings).
-- JSONB columns for flexible, evolving adaptive structures.

CREATE TABLE IF NOT EXISTS learner_adaptive_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Subject-level strength/weakness scores
  subject_strengths JSONB NOT NULL DEFAULT '{}',

  -- Syllabus coverage per GS paper/domain
  syllabus_coverage JSONB NOT NULL DEFAULT '{}',

  -- Detected concept gaps
  concept_gaps JSONB NOT NULL DEFAULT '[]',

  -- Study pattern analysis
  study_patterns JSONB NOT NULL DEFAULT '{}',

  -- Weak areas aggregated at subject level
  subject_weaknesses JSONB NOT NULL DEFAULT '{}',

  -- Adaptive recommendations
  recommendations JSONB NOT NULL DEFAULT '[]',

  -- Computation metadata
  computation_metadata JSONB NOT NULL DEFAULT '{}',

  last_computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT learner_adaptive_profile_user_unique UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_learner_adaptive_profile_user
  ON learner_adaptive_profile(user_id);

-- ─── RLS ─────────────────────────────────────────────────────

ALTER TABLE learner_adaptive_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own adaptive profile" ON learner_adaptive_profile
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Service full access adaptive" ON learner_adaptive_profile
  FOR ALL USING (true) WITH CHECK (true);
