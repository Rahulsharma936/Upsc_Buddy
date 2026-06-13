/**
 * Authentication service.
 * Handles signup/login/logout through Supabase Auth,
 * and profile creation through the repository layer.
 */

import { createClient } from "@/lib/supabase/server";
import { profileRepository } from "@/lib/repositories/profile.repository";
import { AppError, AuthenticationError } from "@/lib/utils/errors";
import type { SignupInput, LoginInput } from "@/lib/validations/auth.schema";

export const authService = {
  async signup(input: SignupInput) {
    const supabase = await createClient();

    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: { full_name: input.fullName },
      },
    });

    if (error) {
      throw new AppError("AUTH_ERROR", error.message, 400);
    }

    if (!data.user) {
      throw new AppError("AUTH_ERROR", "Failed to create user", 500);
    }

    // Note: Profile record is automatically created via Postgres trigger 
    // configured in supabase/migrations/00001_create_profiles.sql

    return {
      user: {
        id: data.user.id,
        email: input.email,
        fullName: input.fullName,
        onboardingCompleted: false,
      },
    };
  },

  async login(input: LoginInput) {
    const supabase = await createClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });

    if (error) {
      throw new AuthenticationError("Invalid email or password");
    }

    const profile = await profileRepository.findById(data.user.id);

    return {
      user: {
        id: data.user.id,
        email: data.user.email ?? input.email,
        fullName: profile?.fullName ?? "",
        onboardingCompleted: profile?.onboardingCompleted ?? false,
      },
    };
  },

  async logout() {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();

    if (error) {
      throw new AppError("AUTH_ERROR", error.message, 500);
    }
  },

  async getSession() {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return null;
    }

    const profile = await profileRepository.findById(user.id);

    return {
      user: {
        id: user.id,
        email: user.email ?? "",
        fullName: profile?.fullName ?? "",
        onboardingCompleted: profile?.onboardingCompleted ?? false,
      },
    };
  },
};
