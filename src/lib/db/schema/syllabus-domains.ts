/**
 * Drizzle schema: syllabus_domains table.
 * Phase 2G: Domains within a GS paper (e.g. "Polity", "Governance").
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { gsPapers } from "./gs-papers";

export const syllabusDomains = pgTable(
  "syllabus_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paperId: uuid("paper_id")
      .notNull()
      .references(() => gsPapers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_syllabus_domains_paper_id").on(table.paperId),
    unique("syllabus_domains_paper_id_name_unique").on(table.paperId, table.name),
  ]
);
