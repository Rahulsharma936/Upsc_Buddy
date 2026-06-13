/**
 * AI processing jobs repository.
 * Data access layer for the ai_processing_jobs table.
 * Manages job lifecycle: create → start → complete/fail.
 * 
 * State transitions are guarded — you cannot mark a "failed" job as "completed".
 */

import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiProcessingJobs } from "@/lib/db/schema";
import type { AIProcessingJob, NewAIProcessingJob } from "@/types/database.types";
import type { AIJobStatus, AIJobType, ProcessingJobMetadata } from "@/lib/ai/types";

/** Valid state transitions for processing jobs. */
const VALID_TRANSITIONS: Record<AIJobStatus, AIJobStatus[]> = {
  pending: ["processing", "failed"],
  processing: ["completed", "failed", "retrying"],
  retrying: ["processing", "failed"],
  completed: [], // terminal state
  failed: [],    // terminal state
};

export const aiJobRepository = {
  async findById(id: string): Promise<AIProcessingJob | undefined> {
    const result = await db
      .select()
      .from(aiProcessingJobs)
      .where(eq(aiProcessingJobs.id, id))
      .limit(1);

    return result[0];
  },

  async findByIdAndUser(
    id: string,
    userId: string
  ): Promise<AIProcessingJob | undefined> {
    const result = await db
      .select()
      .from(aiProcessingJobs)
      .where(
        and(
          eq(aiProcessingJobs.id, id),
          eq(aiProcessingJobs.userId, userId)
        )
      )
      .limit(1);

    return result[0];
  },

  /**
   * Find an active or completed job for a specific daily log and job type.
   * Used for idempotency checks — prevents duplicate extractions.
   */
  async findActiveByDailyLogAndType(
    dailyLogId: string,
    jobType: AIJobType
  ): Promise<AIProcessingJob | undefined> {
    const activeStatuses: AIJobStatus[] = ["pending", "processing", "retrying", "completed"];

    const result = await db
      .select()
      .from(aiProcessingJobs)
      .where(
        and(
          eq(aiProcessingJobs.dailyLogId, dailyLogId),
          eq(aiProcessingJobs.jobType, jobType),
          inArray(aiProcessingJobs.status, activeStatuses)
        )
      )
      .orderBy(desc(aiProcessingJobs.createdAt))
      .limit(1);

    return result[0];
  },

  async findByDailyLog(
    dailyLogId: string,
    userId: string
  ): Promise<AIProcessingJob[]> {
    return db
      .select()
      .from(aiProcessingJobs)
      .where(
        and(
          eq(aiProcessingJobs.dailyLogId, dailyLogId),
          eq(aiProcessingJobs.userId, userId)
        )
      )
      .orderBy(desc(aiProcessingJobs.createdAt));
  },

  async findRecentByUser(
    userId: string,
    limit = 20
  ): Promise<AIProcessingJob[]> {
    return db
      .select()
      .from(aiProcessingJobs)
      .where(eq(aiProcessingJobs.userId, userId))
      .orderBy(desc(aiProcessingJobs.createdAt))
      .limit(limit);
  },

  async create(data: NewAIProcessingJob): Promise<AIProcessingJob> {
    const result = await db
      .insert(aiProcessingJobs)
      .values(data)
      .returning();

    return result[0];
  },

  /**
   * State transition: pending → processing.
   * Guarded: only transitions from valid prior states.
   */
  async markStarted(id: string): Promise<AIProcessingJob | undefined> {
    const validFrom = VALID_TRANSITIONS.pending.includes("processing")
      ? getStatesLeadingTo("processing")
      : [];

    const result = await db
      .update(aiProcessingJobs)
      .set({
        status: "processing" as AIJobStatus,
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(aiProcessingJobs.id, id),
          inArray(aiProcessingJobs.status, validFrom)
        )
      )
      .returning();

    return result[0];
  },

  /**
   * State transition: processing → completed.
   * Merges new metadata with existing metadata.
   */
  async markCompleted(
    id: string,
    metadata?: ProcessingJobMetadata
  ): Promise<AIProcessingJob | undefined> {
    const validFrom = getStatesLeadingTo("completed");

    const result = await db
      .update(aiProcessingJobs)
      .set({
        status: "completed" as AIJobStatus,
        completedAt: new Date(),
        updatedAt: new Date(),
        ...(metadata ? { metadata: sql`COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(metadata)}::jsonb` } : {}),
      })
      .where(
        and(
          eq(aiProcessingJobs.id, id),
          inArray(aiProcessingJobs.status, validFrom)
        )
      )
      .returning();

    return result[0];
  },

  /**
   * State transition: * → failed.
   * Merges new metadata with existing metadata.
   */
  async markFailed(
    id: string,
    errorMessage: string,
    metadata?: ProcessingJobMetadata
  ): Promise<AIProcessingJob | undefined> {
    const result = await db
      .update(aiProcessingJobs)
      .set({
        status: "failed" as AIJobStatus,
        failedAt: new Date(),
        errorMessage,
        updatedAt: new Date(),
        ...(metadata ? { metadata: sql`COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(metadata)}::jsonb` } : {}),
      })
      .where(
        and(
          eq(aiProcessingJobs.id, id),
          // Can fail from any non-terminal state
          inArray(aiProcessingJobs.status, ["pending", "processing", "retrying"] as AIJobStatus[])
        )
      )
      .returning();

    return result[0];
  },

  /**
   * State transition: processing → retrying.
   * Merges retry reason into existing metadata.
   */
  async markRetrying(
    id: string,
    retryCount: number,
    reason?: string
  ): Promise<AIProcessingJob | undefined> {
    const validFrom = getStatesLeadingTo("retrying");
    const retryMeta = reason ? { retryReason: reason, retryCount } : { retryCount };

    const result = await db
      .update(aiProcessingJobs)
      .set({
        status: "retrying" as AIJobStatus,
        retryCount,
        updatedAt: new Date(),
        metadata: sql`COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(retryMeta)}::jsonb`,
      })
      .where(
        and(
          eq(aiProcessingJobs.id, id),
          inArray(aiProcessingJobs.status, validFrom)
        )
      )
      .returning();

    return result[0];
  },

  /**
   * Supersede a completed job that produced 0 results.
   * Transitions completed → failed so the idempotency guard
   * no longer returns the empty cached result.
   *
   * SAFETY: Only used when a completed job has 0 persisted concepts.
   * Added per Audit 1 — completed-empty cache lock fix.
   */
  async markSuperseded(
    id: string,
    reason: string
  ): Promise<AIProcessingJob | undefined> {
    const result = await db
      .update(aiProcessingJobs)
      .set({
        status: "failed" as AIJobStatus,
        failedAt: new Date(),
        errorMessage: reason,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(aiProcessingJobs.id, id),
          eq(aiProcessingJobs.status, "completed" as AIJobStatus)
        )
      )
      .returning();

    return result[0];
  },
};

// ─── Helpers ────────────────────────────────────────────────
/** Find all states that can transition TO the target state. */
function getStatesLeadingTo(target: AIJobStatus): AIJobStatus[] {
  const sources: AIJobStatus[] = [];
  for (const [from, tos] of Object.entries(VALID_TRANSITIONS)) {
    if (tos.includes(target)) {
      sources.push(from as AIJobStatus);
    }
  }
  return sources;
}
