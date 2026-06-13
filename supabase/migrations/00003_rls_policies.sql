-- Migration: Row Level Security Policies
-- Users must only access their own data.

-- ═══════════════════════════════════════════════════════
-- PROFILES RLS
-- ═══════════════════════════════════════════════════════
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "profiles_select_own"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Users can insert their own profile (for the signup trigger)
CREATE POLICY "profiles_insert_own"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ═══════════════════════════════════════════════════════
-- DAILY_LOGS RLS
-- ═══════════════════════════════════════════════════════
ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;

-- Users can read their own logs
CREATE POLICY "daily_logs_select_own"
  ON daily_logs FOR SELECT
  USING (auth.uid() = user_id);

-- Users can create their own logs
CREATE POLICY "daily_logs_insert_own"
  ON daily_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own logs
CREATE POLICY "daily_logs_update_own"
  ON daily_logs FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own logs
CREATE POLICY "daily_logs_delete_own"
  ON daily_logs FOR DELETE
  USING (auth.uid() = user_id);
