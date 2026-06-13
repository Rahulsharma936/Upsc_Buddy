/**
 * Profile service.
 * Business logic for profile operations, including onboarding.
 */

import { profileRepository } from "@/lib/repositories/profile.repository";
import { NotFoundError } from "@/lib/utils/errors";
import type { UserPreferences } from "@/types/database.types";
import type { OnboardingInput } from "@/lib/validations/onboarding.schema";

export const profileService = {
  async getProfile(userId: string) {
    const profile = await profileRepository.findById(userId);
    if (!profile) {
      throw new NotFoundError("Profile");
    }
    return profile;
  },

  async completeOnboarding(userId: string, input: OnboardingInput) {
    const profile = await profileRepository.findById(userId);
    if (!profile) {
      throw new NotFoundError("Profile");
    }

    const preferences: UserPreferences = {
      examTarget: input.examInfo.examTarget,
      studyMode: input.examInfo.studyMode,
      subjectPriorities: input.subjectPriorities,
      studyHoursPerDay: input.studyPreferences.studyHoursPerDay,
      reminderTime: input.studyPreferences.reminderTime,
      language: input.studyPreferences.language,
      onboardingCompletedAt: new Date().toISOString(),
    };

    await profileRepository.updatePreferences(userId, preferences);
    const updated = await profileRepository.markOnboardingComplete(userId);

    return updated;
  },

  async updatePreferences(userId: string, preferences: Partial<UserPreferences>) {
    const profile = await profileRepository.findById(userId);
    if (!profile) {
      throw new NotFoundError("Profile");
    }

    const currentPrefs = (profile.preferences ?? {}) as UserPreferences;
    const merged = { ...currentPrefs, ...preferences };

    return profileRepository.updatePreferences(userId, merged);
  },
};
