-- Migration: Create ai_processing_jobs table
-- Tracks every AI operation for observability, retries, and debugging.

CREATE TABLE IF NOT EXISTS ai_processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  daily_log_id UUID REFERENCES daily_logs(id) ON DELETE SET NULL,
  job_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_ai_jobs_user_id ON ai_processing_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_daily_log_id ON ai_processing_jobs(daily_log_id);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_status ON ai_processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_job_type ON ai_processing_jobs(job_type);

-- Updated_at trigger
CREATE TRIGGER ai_processing_jobs_updated_at
  BEFORE UPDATE ON ai_processing_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- RLS
ALTER TABLE ai_processing_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_jobs_select_own"
  ON ai_processing_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "ai_jobs_insert_own"
  ON ai_processing_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "ai_jobs_update_own"
  ON ai_processing_jobs FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
