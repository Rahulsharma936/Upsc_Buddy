/**
 * Concept context intelligence repository.
 * Phase 3A: Persistence layer for GS mappings + analytical context.
 */

import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { conceptContextIntelligence } from "@/lib/db/schema";
import type {
  ConceptContextRecord,
  NewConceptContextRecord,
} from "@/types/database.types";

export const conceptContextRepository = {
  /**
   * Get context intelligence for a concept.
   */
  async findByConcept(conceptId: string): Promise<ConceptContextRecord | undefined> {
    const result = await db
      .select()
      .from(conceptContextIntelligence)
      .where(eq(conceptContextIntelligence.conceptId, conceptId))
      .limit(1);
    return result[0];
  },

  /**
   * Upsert context intelligence (idempotent).
   * If context already exists for this concept, update it.
   */
  async upsert(data: NewConceptContextRecord): Promise<ConceptContextRecord> {
    const existing = await this.findByConcept(data.conceptId);

    if (existing) {
      const updated = await db
        .update(conceptContextIntelligence)
        .set({
          primaryPaper: data.primaryPaper,
          gsMappings: data.gsMappings,
          constitutionalRelevance: data.constitutionalRelevance,
          governanceRelevance: data.governanceRelevance,
          ethicalDimension: data.ethicalDimension,
          policyImplications: data.policyImplications,
          economicImplications: data.economicImplications,
          currentAffairsSignificance: data.currentAffairsSignificance,
          staticDynamicLink: data.staticDynamicLink,
          mappingConfidence: data.mappingConfidence,
          contextConfidence: data.contextConfidence,
          generationMetadata: data.generationMetadata,
          updatedAt: new Date(),
        })
        .where(eq(conceptContextIntelligence.conceptId, data.conceptId))
        .returning();
      return updated[0];
    }

    const inserted = await db
      .insert(conceptContextIntelligence)
      .values(data)
      .returning();
    return inserted[0];
  },

  /**
   * Delete context for a concept (for regeneration).
   */
  async deleteByConcept(conceptId: string): Promise<number> {
    const result = await db
      .delete(conceptContextIntelligence)
      .where(eq(conceptContextIntelligence.conceptId, conceptId))
      .returning({ id: conceptContextIntelligence.id });
    return result.length;
  },

  /**
   * Get all context records for a user's concepts (batch).
   */
  async findByConceptIds(conceptIds: string[]): Promise<ConceptContextRecord[]> {
    if (conceptIds.length === 0) return [];

    // One query instead of one per concept.
    return db
      .select()
      .from(conceptContextIntelligence)
      .where(inArray(conceptContextIntelligence.conceptId, conceptIds));
  },
};
