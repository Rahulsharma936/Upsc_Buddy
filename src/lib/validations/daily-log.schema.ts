/**
 * Daily log validation schemas.
 */

import { z } from "zod";

export const createDailyLogSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  subjects: z
    .array(z.string())
    .min(1, "Select at least one subject"),
  rawInput: z
    .string()
    .min(10, "Please write at least 10 characters about your study session")
    .max(5000, "Input must be less than 5000 characters"),
  concepts: z
    .array(z.string()),
});

export const updateDailyLogSchema = createDailyLogSchema.partial().extend({
  id: z.string().uuid(),
});

export const dailyLogQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export type CreateDailyLogInput = z.infer<typeof createDailyLogSchema>;
export type UpdateDailyLogInput = z.infer<typeof updateDailyLogSchema>;
