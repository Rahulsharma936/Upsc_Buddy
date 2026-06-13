import type { Metadata } from "next";
import { OnboardingWizard } from "@/components/features/onboarding/OnboardingWizard";

export const metadata: Metadata = {
  title: "Onboarding — UPSC Prep",
};

export default function OnboardingPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold tracking-tight">
            Let&apos;s set up your profile
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This helps us personalize your preparation experience
          </p>
        </div>
        <OnboardingWizard />
      </div>
    </div>
  );
}
