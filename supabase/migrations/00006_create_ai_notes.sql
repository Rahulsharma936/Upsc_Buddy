-- Migration: Create ai_notes table
-- AI-generated study notes tied to specific concepts.
-- Versioned to support regeneration and improvement.

CREATE TABLE IF NOT EXISTS ai_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  content TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  generation_metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_notes_concept_id ON ai_notes(concept_id);
CREATE INDEX IF NOT EXISTS idx_ai_notes_version ON ai_notes(concept_id, version);

-- Updated_at trigger
CREATE TRIGGER ai_notes_updated_at
  BEFORE UPDATE ON ai_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- RLS (access through concept ownership)
ALTER TABLE ai_notes ENABLE ROW LEVEL SECURITY;

-- Users can access notes for their own concepts
CREATE POLICY "ai_notes_select_own"
  ON ai_notes FOR SELECT
  USING (
    concept_id IN (
      SELECT id FROM concepts WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "ai_notes_insert_own"
  ON ai_notes FOR INSERT
  WITH CHECK (
    concept_id IN (
      SELECT id FROM concepts WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "ai_notes_update_own"
  ON ai_notes FOR UPDATE
  USING (
    concept_id IN (
      SELECT id FROM concepts WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    concept_id IN (
      SELECT id FROM concepts WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "ai_notes_delete_own"
  ON ai_notes FOR DELETE
  USING (
    concept_id IN (
      SELECT id FROM concepts WHERE user_id = auth.uid()
    )
  );
