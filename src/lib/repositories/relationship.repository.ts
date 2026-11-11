/**
 * Concept relationship repository.
 * Data access layer for the concept_relationships table.
 *
 * Phase 2D: Supports directional edge queries, dedup checks,
 * cross-subject filtering, and batch operations.
 */

import { eq, and, or, desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { conceptRelationships } from "@/lib/db/schema";
import type {
  ConceptRelationship,
  NewConceptRelationship,
} from "@/types/database.types";

export const relationshipRepository = {
  /**
   * Find a relationship by ID.
   */
  async findById(id: string): Promise<ConceptRelationship | undefined> {
    const result = await db
      .select()
      .from(conceptRelationships)
      .where(eq(conceptRelationships.id, id))
      .limit(1);

    return result[0];
  },

  /**
   * Get all relationships where a concept is the source.
   */
  async findBySource(sourceConceptId: string): Promise<ConceptRelationship[]> {
    return db
      .select()
      .from(conceptRelationships)
      .where(eq(conceptRelationships.sourceConceptId, sourceConceptId))
      .orderBy(desc(conceptRelationships.relationshipStrength));
  },

  /**
   * Get all relationships involving a concept (source OR target).
   */
  async findByConcept(conceptId: string): Promise<ConceptRelationship[]> {
    return db
      .select()
      .from(conceptRelationships)
      .where(
        or(
          eq(conceptRelationships.sourceConceptId, conceptId),
          eq(conceptRelationships.targetConceptId, conceptId)
        )
      )
      .orderBy(desc(conceptRelationships.relationshipStrength));
  },

  /**
   * All relationships touching any of the given concepts, in one query.
   */
  async findByConcepts(conceptIds: string[]): Promise<ConceptRelationship[]> {
    if (conceptIds.length === 0) return [];
    return db
      .select()
      .from(conceptRelationships)
      .where(
        or(
          inArray(conceptRelationships.sourceConceptId, conceptIds),
          inArray(conceptRelationships.targetConceptId, conceptIds)
        )
      )
      .orderBy(desc(conceptRelationships.relationshipStrength));
  },

  /**
   * Check if a directional edge already exists (source → target + type).
   * Also checks the mirror direction (target → source + type) to prevent
   * semantically equivalent duplicates.
   */
  async existsEdge(
    sourceConceptId: string,
    targetConceptId: string,
    relationshipType: string
  ): Promise<boolean> {
    const result = await db
      .select({ id: conceptRelationships.id })
      .from(conceptRelationships)
      .where(
        or(
          // Direct match
          and(
            eq(conceptRelationships.sourceConceptId, sourceConceptId),
            eq(conceptRelationships.targetConceptId, targetConceptId),
            eq(conceptRelationships.relationshipType, relationshipType)
          ),
          // Mirror match (prevents A→B + B→A duplicates)
          and(
            eq(conceptRelationships.sourceConceptId, targetConceptId),
            eq(conceptRelationships.targetConceptId, sourceConceptId),
            eq(conceptRelationships.relationshipType, relationshipType)
          )
        )
      )
      .limit(1);

    return result.length > 0;
  },

  /**
   * Create a new relationship edge.
   * Uses onConflictDoNothing for source+target+type uniqueness.
   */
  async create(data: NewConceptRelationship): Promise<ConceptRelationship | null> {
    const result = await db
      .insert(conceptRelationships)
      .values(data)
      .onConflictDoNothing({
        target: [
          conceptRelationships.sourceConceptId,
          conceptRelationships.targetConceptId,
          conceptRelationships.relationshipType,
        ],
      })
      .returning();

    return result[0] ?? null;
  },

  /**
   * Batch create relationships with conflict handling.
   */
  async createMany(data: NewConceptRelationship[]): Promise<ConceptRelationship[]> {
    if (data.length === 0) return [];

    return db
      .insert(conceptRelationships)
      .values(data)
      .onConflictDoNothing({
        target: [
          conceptRelationships.sourceConceptId,
          conceptRelationships.targetConceptId,
          conceptRelationships.relationshipType,
        ],
      })
      .returning();
  },

  /**
   * Delete all relationships originating from a concept.
   * Used for force-regeneration.
   */
  async deleteBySource(sourceConceptId: string): Promise<number> {
    const result = await db
      .delete(conceptRelationships)
      .where(eq(conceptRelationships.sourceConceptId, sourceConceptId))
      .returning({ id: conceptRelationships.id });

    return result.length;
  },

  /**
   * Get cross-subject relationships for a set of concept IDs.
   */
  async findCrossSubject(conceptIds: string[]): Promise<ConceptRelationship[]> {
    if (conceptIds.length === 0) return [];

    return db
      .select()
      .from(conceptRelationships)
      .where(
        and(
          inArray(conceptRelationships.sourceConceptId, conceptIds),
          eq(conceptRelationships.crossSubject, true)
        )
      )
      .orderBy(desc(conceptRelationships.relationshipStrength));
  },
};
