/**
 * Concept questions repository.
 * Phase 3B: Persistence layer for question intelligence.
 */

import { eq, and, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { conceptQuestions, concepts } from "@/lib/db/schema";
import type {
  ConceptQuestionsRecord,
  NewConceptQuestionsRecord,
} from "@/types/database.types";

export const conceptQuestionsRepository = {
  /**
   * Get questions for a concept.
   */
  async findByConcept(conceptId: string): Promise<ConceptQuestionsRecord | undefined> {
    const result = await db
      .select()
      .from(conceptQuestions)
      .where(eq(conceptQuestions.conceptId, conceptId))
      .limit(1);
    return result[0];
  },

  /**
   * Upsert questions (idempotent regeneration).
   */
  async upsert(data: NewConceptQuestionsRecord): Promise<ConceptQuestionsRecord> {
    const existing = await this.findByConcept(data.conceptId);

    if (existing) {
      const updated = await db
        .update(conceptQuestions)
        .set({
          prelimsMcqs: data.prelimsMcqs,
          mainsQuestions: data.mainsQuestions,
          interviewPrompts: data.interviewPrompts,
          generationConfidence: data.generationConfidence,
          generationMetadata: data.generationMetadata,
          updatedAt: new Date(),
        })
        .where(eq(conceptQuestions.conceptId, data.conceptId))
        .returning();
      return updated[0];
    }

    const inserted = await db
      .insert(conceptQuestions)
      .values(data)
      .returning();
    return inserted[0];
  },

  /**
   * Delete questions for a concept (for regeneration).
   */
  async deleteByConcept(conceptId: string): Promise<number> {
    const result = await db
      .delete(conceptQuestions)
      .where(eq(conceptQuestions.conceptId, conceptId))
      .returning({ id: conceptQuestions.id });
    return result.length;
  },

  /**
   * Inventory-first query: load ALL concepts for a user that have non-empty
   * question inventory. Returns concept metadata + question data in a single
   * JOIN query — no N+1, no arbitrary LIMIT.
   *
   * Result set is naturally bounded by hydration rate (only concepts that
   * have been through the question generation layer appear here).
   *
   * Used by the Practice API to replace the old findByUser(50) + per-concept
   * lookup pattern that excluded historical concepts.
   *
   * Audit 2 remediation — Phase 2.
   */
  async findAllWithConceptByUser(userId: string): Promise<{
    concept: {
      id: string;
      displayName: string;
      subject: string;
      difficulty: string;
      createdAt: Date;
    };
    questions: {
      prelimsMcqs: any[];
      mainsQuestions: any[];
      interviewPrompts: any[];
    };
  }[]> {
    const rows = await db
      .select({
        conceptId: concepts.id,
        displayName: concepts.displayName,
        subject: concepts.subject,
        difficulty: concepts.difficulty,
        createdAt: concepts.createdAt,
        prelimsMcqs: conceptQuestions.prelimsMcqs,
        mainsQuestions: conceptQuestions.mainsQuestions,
        interviewPrompts: conceptQuestions.interviewPrompts,
      })
      .from(conceptQuestions)
      .innerJoin(concepts, eq(conceptQuestions.conceptId, concepts.id))
      .where(
        and(
          eq(concepts.userId, userId),
          // Only include rows where at least one question array is non-empty
          or(
            sql`jsonb_array_length(${conceptQuestions.prelimsMcqs}) > 0`,
            sql`jsonb_array_length(${conceptQuestions.mainsQuestions}) > 0`,
            sql`jsonb_array_length(${conceptQuestions.interviewPrompts}) > 0`
          )
        )
      );

    return rows.map((r) => ({
      concept: {
        id: r.conceptId,
        displayName: r.displayName,
        subject: r.subject,
        difficulty: r.difficulty ?? "intermediate",
        createdAt: r.createdAt,
      },
      questions: {
        prelimsMcqs: (r.prelimsMcqs as any[]) ?? [],
        mainsQuestions: (r.mainsQuestions as any[]) ?? [],
        interviewPrompts: (r.interviewPrompts as any[]) ?? [],
      },
    }));
  },
};
