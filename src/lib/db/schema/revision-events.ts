/**
 * Drizzle schema: revision_events table.
 * Phase 3C: Append-only revision interaction log.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { profiles } from "./profiles";
import { concepts } from "./concepts";

export const revisionEvents = pgTable(
  "revision_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),

    eventType: text("event_type").notNull(),

    // SM-2 quality rating (0-5)
    qualityRating: integer("quality_rating"),

    // MCQ-specific
    mcqCorrect: boolean("mcq_correct"),
    mcqQuestionIndex: integer("mcq_question_index"),

    // Metadata
    eventMetadata: jsonb("event_metadata").notNull().default({}),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_revision_events_user_concept").on(table.userId, table.conceptId),
    index("idx_revision_events_created").on(table.userId, table.createdAt),
  ]
);
