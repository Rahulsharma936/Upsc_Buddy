/**
 * Drizzle schema: concepts table.
 * AI-extracted concepts from daily study logs.
 * 
 * Phase 2B: Added normalized_name for deduplication,
 * display_name for UI, extraction_metadata for observability.
 */

import {
  pgTable,
  uuid,
  text,
  real,
  jsonb,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { profiles } from "./profiles";
import { dailyLogs } from "./daily-logs";

export const concepts = pgTable(
  "concepts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    dailyLogId: uuid("daily_log_id")
      .notNull()
      .references(() => dailyLogs.id, { onDelete: "cascade" }),
    normalizedName: text("normalized_name").notNull(),
    displayName: text("display_name").notNull(),
    name: text("name").notNull(), // Original AI-extracted name (preserved for debugging)
    subject: text("subject").notNull(),
    keywords: text("keywords").array().notNull().default([]),
    difficulty: text("difficulty").notNull().default("intermediate"),
    extractionConfidence: real("extraction_confidence").notNull().default(0.5),
    extractionMetadata: jsonb("extraction_metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("concepts_user_id_idx").on(table.userId),
    index("concepts_daily_log_id_idx").on(table.dailyLogId),
    index("concepts_subject_idx").on(table.subject),
    index("concepts_normalized_name_idx").on(table.normalizedName),
    // Prevent duplicate normalized concepts for the same user + daily log
    unique("concepts_user_log_name_uniq").on(
      table.userId,
      table.dailyLogId,
      table.normalizedName,
      table.subject
    ),
  ]
);
