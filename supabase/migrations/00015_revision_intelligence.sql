-- Phase 3C: Revision Intelligence Engine
-- Two tables: concept_mastery (state) + revision_events (history).
-- SM-2-inspired spaced repetition with UPSC-specific adaptations.

-- ─── Concept Mastery State ────────────────────────────────────
-- Tracks forgetting curve, interval, mastery level per user+concept.

CREATE TABLE IF NOT EXISTS concept_mastery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,

  -- SM-2 inspired state
  ease_factor NUMERIC(4,2) NOT NULL DEFAULT 2.50,
  interval_days INTEGER NOT NULL DEFAULT 1,
  repetition_count INTEGER NOT NULL DEFAULT 0,

  -- Mastery tracking
  mastery_level TEXT NOT NULL DEFAULT 'unseen'
    CHECK (mastery_level IN ('unseen', 'learning', 'reviewing', 'mastered')),
  confidence_score NUMERIC(3,2) NOT NULL DEFAULT 0.00,

  -- Forgetting curve
  last_reviewed_at TIMESTAMPTZ,
  next_review_at TIMESTAMPTZ,

  -- Performance counters
  correct_count INTEGER NOT NULL DEFAULT 0,
  incorrect_count INTEGER NOT NULL DEFAULT 0,
  skip_count INTEGER NOT NULL DEFAULT 0,

  -- Weak area detection
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

-- ─── Revision Events ─────────────────────────────────────────
-- Append-only log of revision interactions.

CREATE TABLE IF NOT EXISTS revision_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,

  event_type TEXT NOT NULL
    CHECK (event_type IN ('review', 'mcq_attempt', 'skip', 'self_assessment')),

  -- SM-2 quality rating (0-5)
  quality_rating INTEGER CHECK (quality_rating >= 0 AND quality_rating <= 5),

  -- MCQ-specific fields
  mcq_correct BOOLEAN,
  mcq_question_index INTEGER,

  -- Metadata
  event_metadata JSONB NOT NULL DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_revision_events_user_concept
  ON revision_events(user_id, concept_id);
CREATE INDEX IF NOT EXISTS idx_revision_events_created
  ON revision_events(user_id, created_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────

ALTER TABLE concept_mastery ENABLE ROW LEVEL SECURITY;
ALTER TABLE revision_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own mastery" ON concept_mastery
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Service full access mastery" ON concept_mastery
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Users read own events" ON revision_events
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Service full access events" ON revision_events
  FOR ALL USING (true) WITH CHECK (true);
