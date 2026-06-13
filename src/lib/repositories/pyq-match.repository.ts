/**
 * PYQ concept match repository.
 * Data access layer for pyq_concept_matches table.
 *
 * Phase 2E: Supports match persistence, concept-scoped retrieval,
 * and conflict-safe upserts.
 */

import { eq, desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { pyqConceptMatches } from "@/lib/db/schema";
import type {
  PYQConceptMatch,
  NewPYQConceptMatch,
} from "@/types/database.types";

export const pyqMatchRepository = {
  /**
   * Get all PYQ matches for a concept, sorted by strength.
   */
  async findByConcept(conceptId: string): Promise<PYQConceptMatch[]> {
    return db
      .select()
      .from(pyqConceptMatches)
      .where(eq(pyqConceptMatches.conceptId, conceptId))
      .orderBy(desc(pyqConceptMatches.matchStrength));
  },

  /**
   * Batch create matches with conflict handling.
   */
  async createMany(data: NewPYQConceptMatch[]): Promise<PYQConceptMatch[]> {
    if (data.length === 0) return [];

    return db
      .insert(pyqConceptMatches)
      .values(data)
      .onConflictDoNothing({
        target: [
          pyqConceptMatches.conceptId,
          pyqConceptMatches.pyqId,
        ],
      })
      .returning();
  },

  /**
   * Delete all matches for a concept (for re-matching).
   */
  async deleteByConcept(conceptId: string): Promise<number> {
    const result = await db
      .delete(pyqConceptMatches)
      .where(eq(pyqConceptMatches.conceptId, conceptId))
      .returning({ id: pyqConceptMatches.id });
    return result.length;
  },
};
