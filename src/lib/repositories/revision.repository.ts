/**
 * Revision intelligence repository.
 * Phase 3C: Persistence for concept mastery state + revision events.
 */

import { eq, and, lte, asc, desc, sql } from "drizzle-orm";
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

  /**
   * R3.3: Find an existing repair event of a given type for an R3.1 requestId.
   *
   * All R3 events carry the originating requestId in their JSONB metadata, so
   * one lookup serves every stage of the repair loop (`repair_verification`,
   * `repair_understanding`, and whatever R3.4 adds).
   *
   * Two uses:
   *   - Idempotency — a stage runs once per repair; a duplicate submit returns
   *     the original event instead of appending a second one.
   *   - Server-side derivation — a later stage reads the facts an earlier stage
   *     already recorded rather than trusting the client for them.
   *
   * Always scoped to the user, so one user's requestId can never mask or
   * expose another's.
   */
  async findRepairEventByRequestId(
    userId: string,
    eventType: string,
    requestId: string
  ): Promise<RevisionEventRecord | undefined> {
    const result = await db
      .select()
      .from(revisionEvents)
      .where(
        and(
          eq(revisionEvents.userId, userId),
          eq(revisionEvents.eventType, eventType),
          sql`${revisionEvents.eventMetadata} ->> 'requestId' = ${requestId}`
        )
      )
      .limit(1);
    return result[0];
  },

  /**
   * R3.3: Find an existing repair_verification event for a given R3.1 requestId.
   *
   * Unchanged behaviour — kept as the named entry point for the verification
   * stage; delegates to the generalized lookup above.
   */
  async findRepairVerification(
    userId: string,
    requestId: string
  ): Promise<RevisionEventRecord | undefined> {
    return this.findRepairEventByRequestId(userId, "repair_verification", requestId);
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

  // ─── R1.4: Evidence Retrieval for R2 ─────────────────────

  /**
   * Get chronological event history for a specific concept.
   * Returns events in ASC order (oldest first) for trajectory analysis.
   * R2 uses this to reconstruct learning sequences per concept.
   */
  async getConceptHistory(
    userId: string,
    conceptId: string,
    limit = 100
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
      .orderBy(asc(revisionEvents.createdAt))
      .limit(limit);
  },

  /**
   * Get chronological event history across ALL concepts for a user.
   * Returns events in ASC order (oldest first).
   * R2 uses this for cross-concept pattern analysis.
   */
  async getEventsByUser(
    userId: string,
    limit = 200
  ): Promise<RevisionEventRecord[]> {
    return db
      .select()
      .from(revisionEvents)
      .where(eq(revisionEvents.userId, userId))
      .orderBy(asc(revisionEvents.createdAt))
      .limit(limit);
  },
};
