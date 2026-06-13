/**
 * Drizzle schema: pyqs table.
 * Phase 2E: Real UPSC Previous Year Questions.
 *
 * This is a shared question bank — NOT user-scoped.
 * PYQs are never AI-generated; they come from verified seed data.
 */

import {
  pgTable,
  uuid,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const pyqs = pgTable(
  "pyqs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    year: integer("year").notNull(),
    examStage: text("exam_stage").notNull(),   // 'prelims' | 'mains'
    paper: text("paper").notNull(),             // 'GS1', 'GS2', etc.
    subject: text("subject").notNull(),
    question: text("question").notNull(),
    keywords: text("keywords").array().notNull().default([]),
    topicTags: text("topic_tags").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_pyqs_year").on(table.year),
    index("idx_pyqs_subject").on(table.subject),
    index("idx_pyqs_exam_stage").on(table.examStage),
    index("idx_pyqs_paper").on(table.paper),
  ]
);
