"use client";

import { useOnboardingStore } from "@/stores/onboarding.store";
import { ExamInfoStep } from "./ExamInfoStep";
import { SubjectPriorityStep } from "./SubjectPriorityStep";
import { StudyPreferencesStep } from "./StudyPreferencesStep";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants/routes";
import { cn } from "@/lib/utils";

export function OnboardingWizard() {
  const router = useRouter();
  const { currentStep, isSubmitting, setIsSubmitting } = useOnboardingStore();
  const store = useOnboardingStore();

  const handleComplete = async () => {
    setIsSubmitting(true);

    try {
      const res = await fetch(ROUTES.API.ONBOARDING, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          examInfo: store.examInfo,
          subjectPriorities: store.subjectPriorities,
          studyPreferences: store.studyPreferences,
        }),
      });

      const data = await res.json();
      if (data.success) {
        store.reset();
        router.push(ROUTES.DASHBOARD);
        router.refresh();
      }
    } catch (error) {
      console.error("Onboarding error:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-xl">
      {/* Progress indicator */}
      <div className="mb-8 flex items-center justify-center gap-2">
        {[1, 2, 3].map((step) => (
          <div key={step} className="flex items-center gap-2">
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors",
                currentStep === step
                  ? "bg-primary text-primary-foreground"
                  : currentStep > step
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground"
              )}
            >
              {step}
            </div>
            {step < 3 && (
              <div
                className={cn(
                  "h-0.5 w-12 transition-colors",
                  currentStep > step ? "bg-primary/40" : "bg-muted"
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      {currentStep === 1 && <ExamInfoStep />}
      {currentStep === 2 && <SubjectPriorityStep />}
      {currentStep === 3 && (
        <StudyPreferencesStep
          onComplete={handleComplete}
          isSubmitting={isSubmitting}
        />
      )}
    </div>
  );
}
