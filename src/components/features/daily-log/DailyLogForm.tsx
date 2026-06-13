"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createDailyLogSchema,
  type CreateDailyLogInput,
} from "@/lib/validations/daily-log.schema";
import { useDailyLog } from "@/hooks/use-daily-log";
import { SubjectSelector } from "./SubjectSelector";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { toISODateString } from "@/lib/utils/date";
import { useRouter } from "next/navigation";

export function DailyLogForm() {
  const router = useRouter();
  const { createLog, isLoading, error } = useDailyLog();
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateDailyLogInput>({
    resolver: zodResolver(createDailyLogSchema),
    defaultValues: {
      date: toISODateString(),
      subjects: [],
      rawInput: "",
      concepts: [],
    },
  });

  const onSubmit = async (data: CreateDailyLogInput) => {
    const result = await createLog(data);
    if (result) {
      reset();
      router.refresh();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">
          Log Study Session
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="date">Date</Label>
            <Input id="date" type="date" {...register("date")} />
            {errors.date && (
              <p className="text-xs text-destructive">{errors.date.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Subjects Studied</Label>
            <Controller
              name="subjects"
              control={control}
              render={({ field }) => (
                <SubjectSelector
                  selected={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            {errors.subjects && (
              <p className="text-xs text-destructive">
                {errors.subjects.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="rawInput">What did you study?</Label>
            <Textarea
              id="rawInput"
              rows={5}
              placeholder="Describe what you covered today. Be specific — topics, chapters, key takeaways..."
              {...register("rawInput")}
            />
            {errors.rawInput && (
              <p className="text-xs text-destructive">
                {errors.rawInput.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="concepts">
              Key Concepts{" "}
              <span className="text-muted-foreground">(optional, comma-separated)</span>
            </Label>
            <Controller
              name="concepts"
              control={control}
              render={({ field }) => (
                <Input
                  id="concepts"
                  placeholder="e.g., Fundamental Rights, Article 21, PIL"
                  onChange={(e) => {
                    const concepts = e.target.value
                      .split(",")
                      .map((c) => c.trim())
                      .filter(Boolean);
                    field.onChange(concepts);
                  }}
                />
              )}
            />
          </div>

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Log
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
