"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  studyPreferencesSchema,
  type StudyPreferencesInput,
} from "@/lib/validations/onboarding.schema";
import { useOnboardingStore } from "@/stores/onboarding.store";
import { APP_CONFIG } from "@/lib/constants/config";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";

interface StudyPreferencesStepProps {
  onComplete: () => Promise<void>;
  isSubmitting: boolean;
}

export function StudyPreferencesStep({
  onComplete,
  isSubmitting,
}: StudyPreferencesStepProps) {
  const { studyPreferences, setStudyPreferences, prevStep } =
    useOnboardingStore();
  const {
    register,
    setValue,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<StudyPreferencesInput>({
    resolver: zodResolver(studyPreferencesSchema),
    defaultValues: studyPreferences,
  });

  const studyHours = watch("studyHoursPerDay");
  const language = watch("language");

  const onSubmit = async (data: StudyPreferencesInput) => {
    setStudyPreferences(data);
    await onComplete();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Study Preferences</CardTitle>
        <CardDescription>
          Configure your daily study routine
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="space-y-2">
            <Label>Study Hours per Day</Label>
            <Select
              value={String(studyHours)}
              onValueChange={(v) => {
                if (v) setValue("studyHoursPerDay", Number(v), { shouldValidate: true });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select hours" />
              </SelectTrigger>
              <SelectContent>
                {APP_CONFIG.studyHoursOptions.map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {h} {h === 1 ? "hour" : "hours"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.studyHoursPerDay && (
              <p className="text-xs text-destructive">
                {errors.studyHoursPerDay.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="reminderTime">Preferred Reminder Time</Label>
            <Input
              id="reminderTime"
              type="time"
              {...register("reminderTime")}
            />
            {errors.reminderTime && (
              <p className="text-xs text-destructive">
                {errors.reminderTime.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Language</Label>
            <Select
              value={language}
              onValueChange={(v) => {
                if (v) setValue("language", v, { shouldValidate: true });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select language" />
              </SelectTrigger>
              <SelectContent>
                {APP_CONFIG.languages.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.language && (
              <p className="text-xs text-destructive">
                {errors.language.message}
              </p>
            )}
          </div>

          <div className="flex justify-between pt-2">
            <Button type="button" variant="ghost" onClick={prevStep}>
              Back
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Complete Setup
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
