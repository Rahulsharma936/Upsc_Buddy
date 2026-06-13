/**
 * Onboarding wizard state management.
 * Lightweight Zustand store for multi-step form state.
 */

import { create } from "zustand";
import type {
  OnboardingStep,
  ExamInfoData,
  SubjectPriorityData,
  StudyPreferencesData,
} from "@/types/onboarding.types";

interface OnboardingState {
  currentStep: OnboardingStep;
  examInfo: ExamInfoData;
  subjectPriorities: SubjectPriorityData;
  studyPreferences: StudyPreferencesData;
  isSubmitting: boolean;

  // Actions
  setStep: (step: OnboardingStep) => void;
  nextStep: () => void;
  prevStep: () => void;
  setExamInfo: (data: ExamInfoData) => void;
  setSubjectPriorities: (data: SubjectPriorityData) => void;
  setStudyPreferences: (data: StudyPreferencesData) => void;
  setIsSubmitting: (value: boolean) => void;
  reset: () => void;
}

const initialState = {
  currentStep: 1 as OnboardingStep,
  examInfo: { examTarget: "", studyMode: "" },
  subjectPriorities: {
    polity: 3,
    geography: 3,
    history: 3,
    economy: 3,
    ethics: 3,
    currentAffairs: 3,
  },
  studyPreferences: {
    studyHoursPerDay: 4,
    reminderTime: "08:00",
    language: "en",
  },
  isSubmitting: false,
};

export const useOnboardingStore = create<OnboardingState>((set) => ({
  ...initialState,

  setStep: (step) => set({ currentStep: step }),

  nextStep: () =>
    set((state) => ({
      currentStep: Math.min(state.currentStep + 1, 3) as OnboardingStep,
    })),

  prevStep: () =>
    set((state) => ({
      currentStep: Math.max(state.currentStep - 1, 1) as OnboardingStep,
    })),

  setExamInfo: (data) => set({ examInfo: data }),

  setSubjectPriorities: (data) => set({ subjectPriorities: data }),

  setStudyPreferences: (data) => set({ studyPreferences: data }),

  setIsSubmitting: (value) => set({ isSubmitting: value }),

  reset: () => set(initialState),
}));
