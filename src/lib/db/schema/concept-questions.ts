/**
 * Drizzle schema: concept_questions table.
 * Phase 3B: Question Intelligence Layer.
 *
 * Stores three question types per concept:
 * - Prelims MCQs (factual discrimination)
 * - Mains questions (analytical framing)
 * - Interview prompts (opinion/reasoning)
 */

import {
  pgTable,
  uuid,
  numeric,
  jsonb,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { concepts } from "./concepts";

export const conceptQuestions = pgTable(
  "concept_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),

    // Question arrays (JSONB)
    prelimsMcqs: jsonb("prelims_mcqs").notNull().default([]),
    mainsQuestions: jsonb("mains_questions").notNull().default([]),
    interviewPrompts: jsonb("interview_prompts").notNull().default([]),

    // Confidence and metadata
    generationConfidence: numeric("generation_confidence", { precision: 3, scale: 2 }).notNull().default("0.50"),
    generationMetadata: jsonb("generation_metadata").notNull().default({}),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_concept_questions_concept_id").on(table.conceptId),
    unique("concept_questions_concept_unique").on(table.conceptId),
  ]
);
