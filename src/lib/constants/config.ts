/**
 * Application configuration constants.
 */

export const APP_CONFIG = {
  name: "UPSC Prep",
  description: "AI-powered UPSC preparation platform",
  version: "0.1.0",
  defaultLanguage: "en",

  pagination: {
    defaultLimit: 10,
    maxLimit: 50,
  },

  onboarding: {
    totalSteps: 3,
  },

  studyModes: [
    { id: "full-time", label: "Full-time Preparation" },
    { id: "working-professional", label: "Working Professional" },
    { id: "college-student", label: "College Student" },
  ] as const,

  examTargets: [
    { id: "cse-2025", label: "CSE 2025" },
    { id: "cse-2026", label: "CSE 2026" },
    { id: "cse-2027", label: "CSE 2027" },
  ] as const,

  languages: [
    { id: "en", label: "English" },
    { id: "hi", label: "Hindi" },
  ] as const,

  studyHoursOptions: [1, 2, 3, 4, 5, 6, 7, 8, 10, 12] as const,
} as const;
