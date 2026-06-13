-- Migration: Create concepts table
-- AI-extracted concepts from daily study logs.

CREATE TABLE IF NOT EXISTS concepts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  daily_log_id UUID NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  keywords TEXT[] NOT NULL DEFAULT '{}',
  difficulty TEXT NOT NULL DEFAULT 'intermediate',
  extraction_confidence REAL NOT NULL DEFAULT 0.5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_concepts_user_id ON concepts(user_id);
CREATE INDEX IF NOT EXISTS idx_concepts_daily_log_id ON concepts(daily_log_id);
CREATE INDEX IF NOT EXISTS idx_concepts_subject ON concepts(subject);
CREATE INDEX IF NOT EXISTS idx_concepts_name ON concepts(name);

-- Updated_at trigger
CREATE TRIGGER concepts_updated_at
  BEFORE UPDATE ON concepts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- RLS
ALTER TABLE concepts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "concepts_select_own"
  ON concepts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "concepts_insert_own"
  ON concepts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "concepts_update_own"
  ON concepts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "concepts_delete_own"
  ON concepts FOR DELETE
  USING (auth.uid() = user_id);
