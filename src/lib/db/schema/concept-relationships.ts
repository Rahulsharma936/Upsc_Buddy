/**
 * Drizzle schema: concept_relationships table.
 * Phase 2D: Directed relationship edges between concepts.
 *
 * Relationship types are constrained to UPSC-relevant categories.
 * Includes cross-subject flag, strength scoring, and generation metadata.
 */

import {
  pgTable,
  uuid,
  text,
  real,
  boolean,
  jsonb,
  timestamp,
  index,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { concepts } from "./concepts";

export const conceptRelationships = pgTable(
  "concept_relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceConceptId: uuid("source_concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    targetConceptId: uuid("target_concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    relationshipType: text("relationship_type").notNull(),
    relationshipStrength: real("relationship_strength").notNull().default(0.5),
    relationshipReason: text("relationship_reason").notNull(),
    crossSubject: boolean("cross_subject").notNull().default(false),
    generatedBy: text("generated_by").notNull(),
    relationshipMetadata: jsonb("relationship_metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_concept_rel_source").on(table.sourceConceptId),
    index("idx_concept_rel_target").on(table.targetConceptId),
    index("idx_concept_rel_type").on(table.relationshipType),
    index("idx_concept_rel_strength").on(table.relationshipStrength),
    unique("concept_rel_source_target_type_uniq").on(
      table.sourceConceptId,
      table.targetConceptId,
      table.relationshipType
    ),
    check(
      "concept_rel_no_self_loop",
      sql`${table.sourceConceptId} != ${table.targetConceptId}`
    ),
  ]
);
