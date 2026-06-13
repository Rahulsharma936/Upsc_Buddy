/**
 * Profile repository.
 * Data access layer for the profiles table.
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import type { Profile, NewProfile, UserPreferences } from "@/types/database.types";

export const profileRepository = {
  async findById(id: string): Promise<Profile | undefined> {
    const result = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, id))
      .limit(1);

    return result[0];
  },

  async create(data: NewProfile): Promise<Profile> {
    const result = await db
      .insert(profiles)
      .values(data)
      .returning();

    return result[0];
  },

  async update(
    id: string,
    data: Partial<Pick<Profile, "fullName" | "onboardingCompleted" | "preferences">>
  ): Promise<Profile> {
    const result = await db
      .update(profiles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(profiles.id, id))
      .returning();

    return result[0];
  },

  async updatePreferences(
    id: string,
    preferences: UserPreferences
  ): Promise<Profile> {
    return this.update(id, { preferences });
  },

  async markOnboardingComplete(id: string): Promise<Profile> {
    return this.update(id, { onboardingCompleted: true });
  },
};
