/**
 * Onboarding validation schemas.
 */

import { z } from "zod";

export const examInfoSchema = z.object({
  examTarget: z.string().min(1, "Please select a target exam"),
  studyMode: z.string().min(1, "Please select a study mode"),
});

export const subjectPrioritySchema = z.object({
  polity: z.number().min(1).max(5),
  geography: z.number().min(1).max(5),
  history: z.number().min(1).max(5),
  economy: z.number().min(1).max(5),
  ethics: z.number().min(1).max(5),
  currentAffairs: z.number().min(1).max(5),
});

export const studyPreferencesSchema = z.object({
  studyHoursPerDay: z.number().min(1).max(16),
  reminderTime: z.string().regex(/^\d{2}:\d{2}$/, "Invalid time format (HH:MM)"),
  language: z.string().min(1, "Please select a language"),
});

export const onboardingSchema = z.object({
  examInfo: examInfoSchema,
  subjectPriorities: subjectPrioritySchema,
  studyPreferences: studyPreferencesSchema,
});

export type ExamInfoInput = z.infer<typeof examInfoSchema>;
export type SubjectPriorityInput = z.infer<typeof subjectPrioritySchema>;
export type StudyPreferencesInput = z.infer<typeof studyPreferencesSchema>;
export type OnboardingInput = z.infer<typeof onboardingSchema>;
