/**
 * Drizzle schema: pyq_concept_matches table.
 * Phase 2E: Links between user concepts and PYQs.
 *
 * Each match includes deterministic strength score and
 * an AI-generated explanation of relevance.
 */

import {
  pgTable,
  uuid,
  real,
  text,
  jsonb,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { concepts } from "./concepts";
import { pyqs } from "./pyqs";

export const pyqConceptMatches = pgTable(
  "pyq_concept_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    pyqId: uuid("pyq_id")
      .notNull()
      .references(() => pyqs.id, { onDelete: "cascade" }),
    matchStrength: real("match_strength").notNull().default(0.5),
    matchReason: text("match_reason").notNull().default(""),
    matchMetadata: jsonb("match_metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_pyq_matches_concept").on(table.conceptId),
    index("idx_pyq_matches_pyq").on(table.pyqId),
    index("idx_pyq_matches_strength").on(table.matchStrength),
    unique("pyq_match_concept_pyq_uniq").on(table.conceptId, table.pyqId),
  ]
);
