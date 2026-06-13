/**
 * Drizzle schema: gs_papers table.
 * Phase 2G: UPSC GS paper registry (GS1–GS4, Essay).
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const gsPapers = pgTable(
  "gs_papers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }
);
