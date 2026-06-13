/**
 * Drizzle schema: ai_processing_jobs table.
 * Tracks every AI operation for observability, retries, and debugging.
 * Every AI call creates a job record — no silent processing.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { profiles } from "./profiles";
import { dailyLogs } from "./daily-logs";

export const aiProcessingJobs = pgTable(
  "ai_processing_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    dailyLogId: uuid("daily_log_id")
      .references(() => dailyLogs.id, { onDelete: "set null" }),
    jobType: text("job_type").notNull(), // concept_extraction, note_generation, etc.
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    status: text("status").notNull().default("pending"), // pending, processing, completed, failed, retrying
    retryCount: integer("retry_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ai_jobs_user_id_idx").on(table.userId),
    index("ai_jobs_daily_log_id_idx").on(table.dailyLogId),
    index("ai_jobs_status_idx").on(table.status),
    index("ai_jobs_job_type_idx").on(table.jobType),
  ]
);
