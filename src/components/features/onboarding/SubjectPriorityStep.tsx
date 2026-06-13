"use client";

import { useOnboardingStore } from "@/stores/onboarding.store";
import { ONBOARDING_SUBJECTS } from "@/lib/constants/subjects";
import { SUBJECT_MAP } from "@/lib/constants/subjects";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { SubjectPriorityData } from "@/types/onboarding.types";

const PRIORITY_LABELS = ["", "Low", "Below Avg", "Average", "High", "Critical"] as const;

export function SubjectPriorityStep() {
  const { subjectPriorities, setSubjectPriorities, nextStep, prevStep } =
    useOnboardingStore();

  const handlePriorityChange = (
    subject: keyof SubjectPriorityData,
    value: number
  ) => {
    setSubjectPriorities({ ...subjectPriorities, [subject]: value });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subject Priorities</CardTitle>
        <CardDescription>
          Rate your priority level for each subject (1-5)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {ONBOARDING_SUBJECTS.map((subjectId) => {
          const subject = SUBJECT_MAP[subjectId];
          const key = subjectId === "current-affairs" ? "currentAffairs" : subjectId;
          const value = subjectPriorities[key as keyof SubjectPriorityData];

          return (
            <div key={subjectId} className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {subject?.label ?? subjectId}
                </span>
                <span className="text-xs text-muted-foreground">
                  {PRIORITY_LABELS[value]}
                </span>
              </div>
              <div className="flex gap-1.5">
                {[1, 2, 3, 4, 5].map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() =>
                      handlePriorityChange(
                        key as keyof SubjectPriorityData,
                        level
                      )
                    }
                    className={cn(
                      "h-2.5 flex-1 rounded-full transition-colors",
                      level <= value
                        ? "bg-primary"
                        : "bg-muted hover:bg-muted-foreground/20"
                    )}
                    aria-label={`Set ${subject?.label} priority to ${level}`}
                  />
                ))}
              </div>
            </div>
          );
        })}

        <div className="flex justify-between pt-2">
          <Button variant="ghost" onClick={prevStep}>
            Back
          </Button>
          <Button onClick={nextStep}>Continue</Button>
        </div>
      </CardContent>
    </Card>
  );
}
