-- Phase 3B: Question Intelligence Layer
-- Stores AI-generated exam simulation questions per concept.
-- Three question types: Prelims MCQs, Mains analytical, Interview prompts.
-- All questions are concept-linked and syllabus-grounded.

CREATE TABLE IF NOT EXISTS concept_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,

  -- Prelims MCQs: [{question, options: {a,b,c,d}, correctAnswer, explanation, difficulty}]
  prelims_mcqs JSONB NOT NULL DEFAULT '[]',

  -- Mains questions: [{question, guidancePoints, estimatedMarks, paperRelevance}]
  mains_questions JSONB NOT NULL DEFAULT '[]',

  -- Interview prompts: [{prompt, expectedDimensions, difficulty}]
  interview_prompts JSONB NOT NULL DEFAULT '[]',

  -- Generation metadata
  generation_confidence NUMERIC(3,2) NOT NULL DEFAULT 0.50,
  generation_metadata JSONB NOT NULL DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One question set per concept
  CONSTRAINT concept_questions_concept_unique UNIQUE(concept_id)
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_concept_questions_concept_id
  ON concept_questions(concept_id);

-- RLS
ALTER TABLE concept_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own concept questions"
  ON concept_questions
  FOR SELECT
  USING (
    concept_id IN (
      SELECT id FROM concepts WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Service role full access on concept_questions"
  ON concept_questions
  FOR ALL
  USING (true)
  WITH CHECK (true);
