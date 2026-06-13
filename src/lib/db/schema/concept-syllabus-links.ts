/**
 * Drizzle schema: concept_syllabus_links table.
 * Phase 2G: Links user concepts to syllabus subtopics.
 */

import {
  pgTable,
  uuid,
  numeric,
  text,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { concepts } from "./concepts";
import { syllabusSubtopics } from "./syllabus-subtopics";

export const conceptSyllabusLinks = pgTable(
  "concept_syllabus_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    subtopicId: uuid("subtopic_id")
      .notNull()
      .references(() => syllabusSubtopics.id, { onDelete: "cascade" }),
    confidenceScore: numeric("confidence_score", { precision: 3, scale: 2 }).notNull(),
    reasoning: text("reasoning"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_concept_syllabus_links_concept_id").on(table.conceptId),
    index("idx_concept_syllabus_links_subtopic_id").on(table.subtopicId),
    unique("concept_syllabus_links_concept_subtopic_unique").on(table.conceptId, table.subtopicId),
  ]
);
