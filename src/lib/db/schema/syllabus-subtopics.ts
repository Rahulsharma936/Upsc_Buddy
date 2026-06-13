/**
 * Drizzle schema: syllabus_subtopics table.
 * Phase 2G: Individual subtopics within a domain.
 */

import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { syllabusDomains } from "./syllabus-domains";

export const syllabusSubtopics = pgTable(
  "syllabus_subtopics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    domainId: uuid("domain_id")
      .notNull()
      .references(() => syllabusDomains.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keywords: jsonb("keywords"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_syllabus_subtopics_domain_id").on(table.domainId),
    unique("syllabus_subtopics_domain_id_name_unique").on(table.domainId, table.name),
  ]
);
