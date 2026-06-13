/**
 * Learner adaptive profile repository.
 * Phase 4: Persistence for computed adaptive intelligence.
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { learnerAdaptiveProfile } from "@/lib/db/schema";
import type {
  LearnerAdaptiveProfileRecord,
  NewLearnerAdaptiveProfileRecord,
} from "@/types/database.types";

export const adaptiveProfileRepository = {
  /** Get adaptive profile for a user. */
  async findByUser(userId: string): Promise<LearnerAdaptiveProfileRecord | undefined> {
    const result = await db
      .select()
      .from(learnerAdaptiveProfile)
      .where(eq(learnerAdaptiveProfile.userId, userId))
      .limit(1);
    return result[0];
  },

  /** Upsert adaptive profile (idempotent). */
  async upsert(data: NewLearnerAdaptiveProfileRecord): Promise<LearnerAdaptiveProfileRecord> {
    const existing = await this.findByUser(data.userId);

    if (existing) {
      const updated = await db
        .update(learnerAdaptiveProfile)
        .set({
          subjectStrengths: data.subjectStrengths,
          syllabusCoverage: data.syllabusCoverage,
          conceptGaps: data.conceptGaps,
          studyPatterns: data.studyPatterns,
          subjectWeaknesses: data.subjectWeaknesses,
          recommendations: data.recommendations,
          computationMetadata: data.computationMetadata,
          lastComputedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(learnerAdaptiveProfile.userId, data.userId))
        .returning();
      return updated[0];
    }

    const inserted = await db
      .insert(learnerAdaptiveProfile)
      .values(data)
      .returning();
    return inserted[0];
  },
};
