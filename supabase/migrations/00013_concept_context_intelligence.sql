-- Phase 3A: Concept Context Intelligence
-- Stores GS mapping + analytical context dimensions per concept.
-- GS mappings are deterministic (ontology-grounded).
-- Context dimensions are AI-generated but validated.

CREATE TABLE IF NOT EXISTS concept_context_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,

  -- Primary GS mapping (deterministic)
  primary_paper TEXT NOT NULL, -- e.g. "GS2"

  -- Scored GS mappings array
  -- [{paper, domain, subtopic, confidence, reason}]
  gs_mappings JSONB NOT NULL DEFAULT '[]',

  -- Analytical dimensions (nullable — only when analytically defensible)
  constitutional_relevance TEXT,
  governance_relevance TEXT,
  ethical_dimension TEXT,
  policy_implications TEXT,
  economic_implications TEXT,
  current_affairs_significance TEXT,
  static_dynamic_link TEXT,

  -- Confidence scores
  mapping_confidence NUMERIC(3,2) NOT NULL DEFAULT 0.50,
  context_confidence NUMERIC(3,2) NOT NULL DEFAULT 0.50,

  -- Generation metadata
  generation_metadata JSONB NOT NULL DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One context record per concept
  CONSTRAINT concept_context_concept_unique UNIQUE(concept_id)
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_concept_context_concept_id
  ON concept_context_intelligence(concept_id);
CREATE INDEX IF NOT EXISTS idx_concept_context_primary_paper
  ON concept_context_intelligence(primary_paper);

-- RLS
ALTER TABLE concept_context_intelligence ENABLE ROW LEVEL SECURITY;

-- Policy: users can read context for their own concepts
CREATE POLICY "Users can read own concept context"
  ON concept_context_intelligence
  FOR SELECT
  USING (
    concept_id IN (
      SELECT id FROM concepts WHERE user_id = auth.uid()
    )
  );

-- Policy: service role can do everything
CREATE POLICY "Service role full access on concept_context"
  ON concept_context_intelligence
  FOR ALL
  USING (true)
  WITH CHECK (true);
