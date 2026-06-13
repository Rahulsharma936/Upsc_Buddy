/**
 * Drizzle schema: concept_context_intelligence table.
 * Phase 3A: GS mapping + contextual reasoning per concept.
 *
 * GS mappings are deterministic (ontology-grounded).
 * Context dimensions are AI-generated but validated.
 */

import {
  pgTable,
  uuid,
  text,
  numeric,
  jsonb,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { concepts } from "./concepts";

export const conceptContextIntelligence = pgTable(
  "concept_context_intelligence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),

    // Primary GS mapping
    primaryPaper: text("primary_paper").notNull(),

    // Scored GS mappings array
    gsMappings: jsonb("gs_mappings").notNull().default([]),

    // Analytical dimensions (nullable)
    constitutionalRelevance: text("constitutional_relevance"),
    governanceRelevance: text("governance_relevance"),
    ethicalDimension: text("ethical_dimension"),
    policyImplications: text("policy_implications"),
    economicImplications: text("economic_implications"),
    currentAffairsSignificance: text("current_affairs_significance"),
    staticDynamicLink: text("static_dynamic_link"),

    // Confidence scores
    mappingConfidence: numeric("mapping_confidence", { precision: 3, scale: 2 }).notNull().default("0.50"),
    contextConfidence: numeric("context_confidence", { precision: 3, scale: 2 }).notNull().default("0.50"),

    // Metadata
    generationMetadata: jsonb("generation_metadata").notNull().default({}),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_concept_context_concept_id").on(table.conceptId),
    index("idx_concept_context_primary_paper").on(table.primaryPaper),
    unique("concept_context_concept_unique").on(table.conceptId),
  ]
);
