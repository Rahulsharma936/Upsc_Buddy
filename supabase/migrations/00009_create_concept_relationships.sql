-- Migration: Create concept_relationships table
-- Phase 2D: Concept Relationship Intelligence Layer
-- Stores directed relationship edges between concepts with UPSC-specific typing.

CREATE TABLE IF NOT EXISTS concept_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  target_concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  relationship_strength REAL NOT NULL DEFAULT 0.5,
  relationship_reason TEXT NOT NULL,
  cross_subject BOOLEAN NOT NULL DEFAULT false,
  generated_by TEXT NOT NULL,
  relationship_metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent duplicate directional edges
  CONSTRAINT concept_rel_source_target_type_uniq
    UNIQUE (source_concept_id, target_concept_id, relationship_type),

  -- Prevent self-loops
  CONSTRAINT concept_rel_no_self_loop
    CHECK (source_concept_id != target_concept_id)
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_concept_rel_source ON concept_relationships(source_concept_id);
CREATE INDEX IF NOT EXISTS idx_concept_rel_target ON concept_relationships(target_concept_id);
CREATE INDEX IF NOT EXISTS idx_concept_rel_type ON concept_relationships(relationship_type);
CREATE INDEX IF NOT EXISTS idx_concept_rel_strength ON concept_relationships(relationship_strength DESC);
CREATE INDEX IF NOT EXISTS idx_concept_rel_cross_subject ON concept_relationships(cross_subject) WHERE cross_subject = true;

-- RLS
ALTER TABLE concept_relationships ENABLE ROW LEVEL SECURITY;

-- Users can read relationships for their own concepts
CREATE POLICY "Users can read own concept relationships"
  ON concept_relationships
  FOR SELECT
  USING (
    source_concept_id IN (SELECT id FROM concepts WHERE user_id = auth.uid())
    OR target_concept_id IN (SELECT id FROM concepts WHERE user_id = auth.uid())
  );

-- Service role can insert/update
CREATE POLICY "Service can manage concept relationships"
  ON concept_relationships
  FOR ALL
  USING (true)
  WITH CHECK (true);
