/**
 * Drizzle schema: concept_mastery table.
 * Phase 3C: SM-2-inspired spaced repetition state per user+concept.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  jsonb,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { profiles } from "./profiles";
import { concepts } from "./concepts";

export const conceptMastery = pgTable(
  "concept_mastery",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),

    // SM-2 state
    easeFactor: numeric("ease_factor", { precision: 4, scale: 2 }).notNull().default("2.50"),
    intervalDays: integer("interval_days").notNull().default(1),
    repetitionCount: integer("repetition_count").notNull().default(0),

    // Mastery
    masteryLevel: text("mastery_level").notNull().default("unseen"),
    confidenceScore: numeric("confidence_score", { precision: 3, scale: 2 }).notNull().default("0.00"),

    // Forgetting curve
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    nextReviewAt: timestamp("next_review_at", { withTimezone: true }),

    // Performance
    correctCount: integer("correct_count").notNull().default(0),
    incorrectCount: integer("incorrect_count").notNull().default(0),
    skipCount: integer("skip_count").notNull().default(0),

    // Weak area
    isWeakArea: boolean("is_weak_area").notNull().default(false),
    weakSignals: jsonb("weak_signals").notNull().default([]),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_concept_mastery_user_id").on(table.userId),
    index("idx_concept_mastery_concept_id").on(table.conceptId),
    index("idx_concept_mastery_next_review").on(table.userId, table.nextReviewAt),
    unique("concept_mastery_user_concept_unique").on(table.userId, table.conceptId),
  ]
);
