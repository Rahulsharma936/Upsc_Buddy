/**
 * Auth hook for client-side auth operations.
 */

"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ROUTES } from "@/lib/constants/routes";
import type { AuthUser } from "@/types/auth.types";

export function useAuth() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(
    async (email: string, password: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch(ROUTES.API.AUTH.LOGIN, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });

        const data = await res.json();

        if (!data.success) {
          setError(data.error.message);
          return null;
        }

        router.push(ROUTES.DASHBOARD);
        router.refresh();
        return data.data.user as AuthUser;
      } catch {
        setError("An unexpected error occurred");
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [router]
  );

  const signup = useCallback(
    async (email: string, password: string, fullName: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch(ROUTES.API.AUTH.SIGNUP, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, fullName }),
        });

        const data = await res.json();

        if (!data.success) {
          setError(data.error.message);
          return null;
        }

        router.push(ROUTES.ONBOARDING);
        router.refresh();
        return data.data.user as AuthUser;
      } catch {
        setError("An unexpected error occurred");
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [router]
  );

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      await fetch(ROUTES.API.AUTH.LOGOUT, { method: "POST" });
      router.push(ROUTES.LOGIN);
      router.refresh();
    } catch {
      setError("Failed to logout");
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  return { login, signup, logout, isLoading, error, setError };
}
