/**
 * Auth helper for API route handlers.
 * Extracts and validates the current user from the request.
 */

import { createClient } from "@/lib/supabase/server";

export async function getAuthenticatedUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}
