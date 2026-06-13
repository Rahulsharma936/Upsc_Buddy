/**
 * Drizzle schema: ai_notes table.
 * AI-generated study notes tied to specific concepts.
 *
 * Phase 2C: Cognitive-compression model with 5 structured sections:
 * core_idea, exam_triggers, static_current_link,
 * answer_writing_angles, memory_hooks.
 * Content-hash dedup + unique version constraint.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { concepts } from "./concepts";

export const aiNotes = pgTable(
  "ai_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    content: text("content").notNull(), // Full rendered markdown
    coreIdea: text("core_idea").notNull().default(""),
    examTriggers: text("exam_triggers").array().notNull().default([]),
    staticCurrentLink: text("static_current_link").array().notNull().default([]),
    answerWritingAngles: text("answer_writing_angles").array().notNull().default([]),
    memoryHooks: text("memory_hooks").array().notNull().default([]),
    contentHash: text("content_hash"),
    generatedBy: text("generated_by").notNull(),
    generationMetadata: jsonb("generation_metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ai_notes_concept_id_idx").on(table.conceptId),
    index("ai_notes_version_idx").on(table.conceptId, table.version),
    index("ai_notes_content_hash_idx").on(table.contentHash),
    unique("ai_notes_concept_version_uniq").on(table.conceptId, table.version),
  ]
);
