/**
 * Onboarding flow types.
 */

export interface ExamInfoData {
  examTarget: string;
  studyMode: string;
}

export interface SubjectPriorityData {
  polity: number;
  geography: number;
  history: number;
  economy: number;
  ethics: number;
  currentAffairs: number;
}

export interface StudyPreferencesData {
  studyHoursPerDay: number;
  reminderTime: string;
  language: string;
}

export interface OnboardingData {
  examInfo: ExamInfoData;
  subjectPriorities: SubjectPriorityData;
  studyPreferences: StudyPreferencesData;
}

export type OnboardingStep = 1 | 2 | 3;
