/**
 * Revision intelligence repository.
 * Phase 3C: Persistence for concept mastery state + revision events.
 */

import { eq, and, lte, asc, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { conceptMastery, revisionEvents } from "@/lib/db/schema";
import type {
  ConceptMasteryRecord,
  NewConceptMasteryRecord,
  RevisionEventRecord,
  NewRevisionEventRecord,
} from "@/types/database.types";

export const revisionRepository = {
  // ─── Mastery State ──────────────────────────────────────

  /** Get mastery record for a user+concept. */
  async getMastery(userId: string, conceptId: string): Promise<ConceptMasteryRecord | undefined> {
    const result = await db
      .select()
      .from(conceptMastery)
      .where(
        and(
          eq(conceptMastery.userId, userId),
          eq(conceptMastery.conceptId, conceptId)
        )
      )
      .limit(1);
    return result[0];
  },

  /** Upsert mastery state (idempotent). */
  async upsertMastery(data: NewConceptMasteryRecord): Promise<ConceptMasteryRecord> {
    const existing = await this.getMastery(data.userId, data.conceptId);

    if (existing) {
      const updated = await db
        .update(conceptMastery)
        .set({
          easeFactor: data.easeFactor,
          intervalDays: data.intervalDays,
          repetitionCount: data.repetitionCount,
          masteryLevel: data.masteryLevel,
          confidenceScore: data.confidenceScore,
          lastReviewedAt: data.lastReviewedAt,
          nextReviewAt: data.nextReviewAt,
          correctCount: data.correctCount,
          incorrectCount: data.incorrectCount,
          skipCount: data.skipCount,
          isWeakArea: data.isWeakArea,
          weakSignals: data.weakSignals,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(conceptMastery.userId, data.userId),
            eq(conceptMastery.conceptId, data.conceptId)
          )
        )
        .returning();
      return updated[0];
    }

    const inserted = await db
      .insert(conceptMastery)
      .values(data)
      .returning();
    return inserted[0];
  },

  /** Get concepts due for revision (next_review_at <= now). */
  async getDueForRevision(userId: string, limit = 20): Promise<ConceptMasteryRecord[]> {
    return db
      .select()
      .from(conceptMastery)
      .where(
        and(
          eq(conceptMastery.userId, userId),
          lte(conceptMastery.nextReviewAt, new Date())
        )
      )
      .orderBy(asc(conceptMastery.nextReviewAt))
      .limit(limit);
  },

  /** Get all weak areas for a user. */
  async getWeakAreas(userId: string): Promise<ConceptMasteryRecord[]> {
    return db
      .select()
      .from(conceptMastery)
      .where(
        and(
          eq(conceptMastery.userId, userId),
          eq(conceptMastery.isWeakArea, true)
        )
      )
      .orderBy(desc(conceptMastery.updatedAt));
  },

  /** Get all mastery records for a user. */
  async getAllMastery(userId: string): Promise<ConceptMasteryRecord[]> {
    return db
      .select()
      .from(conceptMastery)
      .where(eq(conceptMastery.userId, userId))
      .orderBy(asc(conceptMastery.nextReviewAt));
  },

  // ─── Revision Events ────────────────────────────────────

  /** Log a revision event (append-only). */
  async logEvent(data: NewRevisionEventRecord): Promise<RevisionEventRecord> {
    const inserted = await db
      .insert(revisionEvents)
      .values(data)
      .returning();
    return inserted[0];
  },

  /** Get recent events for a concept. */
  async getRecentEvents(
    userId: string,
    conceptId: string,
    limit = 10
  ): Promise<RevisionEventRecord[]> {
    return db
      .select()
      .from(revisionEvents)
      .where(
        and(
          eq(revisionEvents.userId, userId),
          eq(revisionEvents.conceptId, conceptId)
        )
      )
      .orderBy(desc(revisionEvents.createdAt))
      .limit(limit);
  },

  /** Get revision stats for a user. */
  async getRevisionStats(userId: string): Promise<{
    totalReviews: number;
    totalMastered: number;
    totalWeak: number;
    totalDue: number;
  }> {
    const allMastery = await this.getAllMastery(userId);
    const now = new Date();

    return {
      totalReviews: allMastery.reduce((sum, m) => sum + m.repetitionCount, 0),
      totalMastered: allMastery.filter((m) => m.masteryLevel === "mastered").length,
      totalWeak: allMastery.filter((m) => m.isWeakArea).length,
      totalDue: allMastery.filter(
        (m) => m.nextReviewAt && m.nextReviewAt <= now
      ).length,
    };
  },
};
