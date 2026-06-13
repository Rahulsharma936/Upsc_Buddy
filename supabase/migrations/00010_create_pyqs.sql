-- Migration: PYQ tables for Phase 2E
-- Creates pyqs (real UPSC questions) and pyq_concept_matches (concept ↔ PYQ links)

-- ─── PYQ Bank ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pyqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INTEGER NOT NULL,
  exam_stage TEXT NOT NULL,             -- 'prelims' | 'mains'
  paper TEXT NOT NULL,                  -- 'GS1', 'GS2', 'GS3', 'GS4', 'Essay', 'CSAT'
  subject TEXT NOT NULL,                -- e.g. 'Polity', 'Economics'
  question TEXT NOT NULL,
  keywords TEXT[] NOT NULL DEFAULT '{}',
  topic_tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pyqs_year ON pyqs(year DESC);
CREATE INDEX IF NOT EXISTS idx_pyqs_subject ON pyqs(subject);
CREATE INDEX IF NOT EXISTS idx_pyqs_exam_stage ON pyqs(exam_stage);
CREATE INDEX IF NOT EXISTS idx_pyqs_paper ON pyqs(paper);

-- ─── Concept ↔ PYQ Matches ───────────────────────────────────
CREATE TABLE IF NOT EXISTS pyq_concept_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  pyq_id UUID NOT NULL REFERENCES pyqs(id) ON DELETE CASCADE,
  match_strength REAL NOT NULL DEFAULT 0.5,
  match_reason TEXT NOT NULL DEFAULT '',
  match_metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One match per concept ↔ pyq pair
  CONSTRAINT pyq_match_concept_pyq_uniq UNIQUE (concept_id, pyq_id)
);

CREATE INDEX IF NOT EXISTS idx_pyq_matches_concept ON pyq_concept_matches(concept_id);
CREATE INDEX IF NOT EXISTS idx_pyq_matches_pyq ON pyq_concept_matches(pyq_id);
CREATE INDEX IF NOT EXISTS idx_pyq_matches_strength ON pyq_concept_matches(match_strength DESC);

-- ─── RLS ──────────────────────────────────────────────────────
ALTER TABLE pyqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pyq_concept_matches ENABLE ROW LEVEL SECURITY;

-- PYQs are public read (shared bank)
CREATE POLICY "Anyone can read PYQs" ON pyqs FOR SELECT USING (true);

-- Matches are scoped via concept ownership
CREATE POLICY "Users can read own PYQ matches" ON pyq_concept_matches
  FOR SELECT USING (
    concept_id IN (SELECT id FROM concepts WHERE user_id = auth.uid())
  );

CREATE POLICY "Service can manage PYQ matches" ON pyq_concept_matches
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service can manage PYQs" ON pyqs
  FOR ALL USING (true) WITH CHECK (true);
