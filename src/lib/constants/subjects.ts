/**
 * UPSC subject definitions.
 * Centralized source of truth for all subject-related data.
 */

export const UPSC_SUBJECTS = [
  { id: "polity", label: "Polity & Governance", color: "#6366f1" },
  { id: "geography", label: "Geography", color: "#059669" },
  { id: "history", label: "History", color: "#d97706" },
  { id: "economy", label: "Economy", color: "#2563eb" },
  { id: "ethics", label: "Ethics & Integrity", color: "#7c3aed" },
  { id: "current-affairs", label: "Current Affairs", color: "#dc2626" },
  { id: "science-tech", label: "Science & Technology", color: "#0891b2" },
  { id: "environment", label: "Environment & Ecology", color: "#16a34a" },
  { id: "international-relations", label: "International Relations", color: "#9333ea" },
  { id: "society", label: "Indian Society", color: "#ea580c" },
  { id: "essay", label: "Essay", color: "#64748b" },
  { id: "csat", label: "CSAT", color: "#475569" },
] as const;

export type SubjectId = (typeof UPSC_SUBJECTS)[number]["id"];

export const SUBJECT_MAP: Record<string, (typeof UPSC_SUBJECTS)[number]> =
  Object.fromEntries(UPSC_SUBJECTS.map((s) => [s.id, s]));

export const SUBJECT_IDS = UPSC_SUBJECTS.map((s) => s.id);

/**
 * Priority subjects used in onboarding (core GS subjects).
 */
export const ONBOARDING_SUBJECTS = [
  "polity",
  "geography",
  "history",
  "economy",
  "ethics",
  "current-affairs",
] as const;

export type OnboardingSubjectId = (typeof ONBOARDING_SUBJECTS)[number];
