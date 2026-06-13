/**
 * Drizzle schema: learner_adaptive_profile table.
 * Phase 4: Single computed-state row per user.
 * All adaptive intelligence is derived from existing data, not AI-generated.
 */

import {
  pgTable,
  uuid,
  jsonb,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { profiles } from "./profiles";

export const learnerAdaptiveProfile = pgTable(
  "learner_adaptive_profile",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    subjectStrengths: jsonb("subject_strengths").notNull().default({}),
    syllabusCoverage: jsonb("syllabus_coverage").notNull().default({}),
    conceptGaps: jsonb("concept_gaps").notNull().default([]),
    studyPatterns: jsonb("study_patterns").notNull().default({}),
    subjectWeaknesses: jsonb("subject_weaknesses").notNull().default({}),
    recommendations: jsonb("recommendations").notNull().default([]),
    computationMetadata: jsonb("computation_metadata").notNull().default({}),

    lastComputedAt: timestamp("last_computed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_learner_adaptive_profile_user").on(table.userId),
    unique("learner_adaptive_profile_user_unique").on(table.userId),
  ]
);
