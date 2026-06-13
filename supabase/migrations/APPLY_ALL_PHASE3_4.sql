-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SAFE MIGRATION SCRIPT — Applies all missing Phase 3+4 tables.
-- Uses IF NOT EXISTS everywhere. Safe to run multiple times.
-- Paste this entire block into Supabase SQL Editor and run.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ─── 00013: Concept Context Intelligence ─────────────────────

CREATE TABLE IF NOT EXISTS concept_context_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  primary_paper TEXT NOT NULL,
  gs_mappings JSONB NOT NULL DEFAULT '[]',
  constitutional_relevance TEXT,
  governance_relevance TEXT,
  ethical_dimension TEXT,
  policy_implications TEXT,
  economic_implications TEXT,
  current_affairs_significance TEXT,
  static_dynamic_link TEXT,
  mapping_confidence NUMERIC(3,2) NOT NULL DEFAULT 0.50,
  context_confidence NUMERIC(3,2) NOT NULL DEFAULT 0.50,
  generation_metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT concept_context_concept_unique UNIQUE(concept_id)
);

CREATE INDEX IF NOT EXISTS idx_concept_context_concept_id
  ON concept_context_intelligence(concept_id);
CREATE INDEX IF NOT EXISTS idx_concept_context_primary_paper
  ON concept_context_intelligence(primary_paper);

ALTER TABLE concept_context_intelligence ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'concept_context_intelligence' AND policyname = 'Users can read own concept context'
  ) THEN
    CREATE POLICY "Users can read own concept context"
      ON concept_context_intelligence FOR SELECT
      USING (concept_id IN (SELECT id FROM concepts WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'concept_context_intelligence' AND policyname = 'Service role full access on concept_context'
  ) THEN
    CREATE POLICY "Service role full access on concept_context"
      ON concept_context_intelligence FOR ALL
      USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ─── 00014: Concept Questions ────────────────────────────────

CREATE TABLE IF NOT EXISTS concept_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  prelims_mcqs JSONB NOT NULL DEFAULT '[]',
  mains_questions JSONB NOT NULL DEFAULT '[]',
  interview_prompts JSONB NOT NULL DEFAULT '[]',
  generation_confidence NUMERIC(3,2) NOT NULL DEFAULT 0.50,
  generation_metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT concept_questions_concept_unique UNIQUE(concept_id)
);

CREATE INDEX IF NOT EXISTS idx_concept_questions_concept_id
  ON concept_questions(concept_id);

ALTER TABLE concept_questions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'concept_questions' AND policyname = 'Users can read own concept questions'
  ) THEN
    CREATE POLICY "Users can read own concept questions"
      ON concept_questions FOR SELECT
      USING (concept_id IN (SELECT id FROM concepts WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'concept_questions' AND policyname = 'Service role full access on concept_questions'
  ) THEN
    CREATE POLICY "Service role full access on concept_questions"
      ON concept_questions FOR ALL
      USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ─── 00015: Revision Intelligence ───────────────────────────

CREATE TABLE IF NOT EXISTS concept_mastery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  ease_factor NUMERIC(4,2) NOT NULL DEFAULT 2.50,
  interval_days INTEGER NOT NULL DEFAULT 1,
  repetition_count INTEGER NOT NULL DEFAULT 0,
  mastery_level TEXT NOT NULL DEFAULT 'unseen'
    CHECK (mastery_level IN ('unseen', 'learning', 'reviewing', 'mastered')),
  confidence_score NUMERIC(3,2) NOT NULL DEFAULT 0.00,
  last_reviewed_at TIMESTAMPTZ,
  next_review_at TIMESTAMPTZ,
  correct_count INTEGER NOT NULL DEFAULT 0,
  incorrect_count INTEGER NOT NULL DEFAULT 0,
  skip_count INTEGER NOT NULL DEFAULT 0,
  is_weak_area BOOLEAN NOT NULL DEFAULT false,
  weak_signals JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT concept_mastery_user_concept_unique UNIQUE(user_id, concept_id)
);

CREATE INDEX IF NOT EXISTS idx_concept_mastery_user_id ON concept_mastery(user_id);
CREATE INDEX IF NOT EXISTS idx_concept_mastery_concept_id ON concept_mastery(concept_id);
CREATE INDEX IF NOT EXISTS idx_concept_mastery_next_review ON concept_mastery(user_id, next_review_at);
CREATE INDEX IF NOT EXISTS idx_concept_mastery_weak ON concept_mastery(user_id, is_weak_area)
  WHERE is_weak_area = true;

CREATE TABLE IF NOT EXISTS revision_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('review', 'mcq_attempt', 'skip', 'self_assessment')),
  quality_rating INTEGER CHECK (quality_rating >= 0 AND quality_rating <= 5),
  mcq_correct BOOLEAN,
  mcq_question_index INTEGER,
  event_metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_revision_events_user_concept
  ON revision_events(user_id, concept_id);
CREATE INDEX IF NOT EXISTS idx_revision_events_created
  ON revision_events(user_id, created_at DESC);

ALTER TABLE concept_mastery ENABLE ROW LEVEL SECURITY;
ALTER TABLE revision_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'concept_mastery' AND policyname = 'Users read own mastery'
  ) THEN
    CREATE POLICY "Users read own mastery" ON concept_mastery
      FOR SELECT USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'concept_mastery' AND policyname = 'Service full access mastery'
  ) THEN
    CREATE POLICY "Service full access mastery" ON concept_mastery
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'revision_events' AND policyname = 'Users read own events'
  ) THEN
    CREATE POLICY "Users read own events" ON revision_events
      FOR SELECT USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'revision_events' AND policyname = 'Service full access events'
  ) THEN
    CREATE POLICY "Service full access events" ON revision_events
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ─── 00016: Adaptive Intelligence ───────────────────────────

CREATE TABLE IF NOT EXISTS learner_adaptive_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject_strengths JSONB NOT NULL DEFAULT '{}',
  syllabus_coverage JSONB NOT NULL DEFAULT '{}',
  concept_gaps JSONB NOT NULL DEFAULT '[]',
  study_patterns JSONB NOT NULL DEFAULT '{}',
  subject_weaknesses JSONB NOT NULL DEFAULT '{}',
  recommendations JSONB NOT NULL DEFAULT '[]',
  computation_metadata JSONB NOT NULL DEFAULT '{}',
  last_computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT learner_adaptive_profile_user_unique UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_learner_adaptive_profile_user
  ON learner_adaptive_profile(user_id);

ALTER TABLE learner_adaptive_profile ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'learner_adaptive_profile' AND policyname = 'Users read own adaptive profile'
  ) THEN
    CREATE POLICY "Users read own adaptive profile" ON learner_adaptive_profile
      FOR SELECT USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'learner_adaptive_profile' AND policyname = 'Service full access adaptive'
  ) THEN
    CREATE POLICY "Service full access adaptive" ON learner_adaptive_profile
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- DONE. Safe to run multiple times.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
