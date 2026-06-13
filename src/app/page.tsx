import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ROUTES } from "@/lib/constants/routes";

/**
 * Root page — redirects based on auth state.
 */
export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(ROUTES.DASHBOARD);
  } else {
    redirect(ROUTES.LOGIN);
  }
}
