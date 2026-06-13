"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { examInfoSchema, type ExamInfoInput } from "@/lib/validations/onboarding.schema";
import { useOnboardingStore } from "@/stores/onboarding.store";
import { APP_CONFIG } from "@/lib/constants/config";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function ExamInfoStep() {
  const { examInfo, setExamInfo, nextStep } = useOnboardingStore();
  const {
    setValue,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ExamInfoInput>({
    resolver: zodResolver(examInfoSchema),
    defaultValues: examInfo,
  });

  const examTarget = watch("examTarget");
  const studyMode = watch("studyMode");

  const onSubmit = (data: ExamInfoInput) => {
    setExamInfo(data);
    nextStep();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Exam Information</CardTitle>
        <CardDescription>
          Tell us about your target exam and preparation style
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="space-y-2">
            <Label>Target Exam</Label>
            <Select
              value={examTarget}
              onValueChange={(v) => { if (v) setValue("examTarget", v, { shouldValidate: true }); }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select target exam" />
              </SelectTrigger>
              <SelectContent>
                {APP_CONFIG.examTargets.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.examTarget && (
              <p className="text-xs text-destructive">{errors.examTarget.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Study Mode</Label>
            <Select
              value={studyMode}
              onValueChange={(v) => { if (v) setValue("studyMode", v, { shouldValidate: true }); }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select study mode" />
              </SelectTrigger>
              <SelectContent>
                {APP_CONFIG.studyModes.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.studyMode && (
              <p className="text-xs text-destructive">{errors.studyMode.message}</p>
            )}
          </div>

          <div className="flex justify-end">
            <Button type="submit">Continue</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
