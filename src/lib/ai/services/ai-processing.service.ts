/**
 * AI processing service.
 * Orchestrates the lifecycle of AI jobs.
 * Manages state transitions: pending → processing → completed/failed.
 * 
 * This is the central coordination layer — it calls the AI client,
 * validates outputs, and persists results through repositories.
 */

import { getAIConfig } from "@/lib/ai/constants";
import { aiJobRepository } from "@/lib/repositories/ai-job.repository";
import { createAILogger } from "@/lib/ai/utils/logger";
import type {
  AIJobType,
  ProcessingJobMetadata,
} from "@/lib/ai/types";
import type { AIProcessingJob } from "@/types/database.types";

const log = createAILogger("ai-processing");

export const aiProcessingService = {
  /**
   * Create a new processing job and return its ID.
   * The job starts in "pending" state.
   */
  async createJob(params: {
    userId: string;
    dailyLogId?: string;
    jobType: AIJobType;
  }): Promise<AIProcessingJob> {
    const config = getAIConfig();

    const job = await aiJobRepository.create({
      userId: params.userId,
      dailyLogId: params.dailyLogId ?? null,
      jobType: params.jobType,
      provider: config.provider,
      model: config.model,
      status: "pending",
      retryCount: 0,
      metadata: {},
    });

    log.processing({
      jobId: job.id,
      action: "Job created",
      provider: config.provider,
      model: config.model,
      status: "pending",
      metadata: { jobType: params.jobType },
    });

    return job;
  },

  /**
   * Mark a job as started (processing).
   */
  async startJob(jobId: string): Promise<void> {
    await aiJobRepository.markStarted(jobId);

    log.processing({
      jobId,
      action: "Job started",
      status: "processing",
    });
  },

  /**
   * Mark a job as completed with metadata.
   */
  async completeJob(
    jobId: string,
    metadata: ProcessingJobMetadata
  ): Promise<void> {
    await aiJobRepository.markCompleted(jobId, metadata);

    log.processing({
      jobId,
      action: "Job completed",
      status: "completed",
      latencyMs: metadata.latencyMs,
      provider: metadata.provider,
      model: metadata.model,
    });
  },

  /**
   * Mark a job as failed with error information.
   */
  async failJob(
    jobId: string,
    error: string,
    metadata?: ProcessingJobMetadata
  ): Promise<void> {
    await aiJobRepository.markFailed(jobId, error, metadata);

    log.processing({
      jobId,
      action: "Job failed",
      status: "failed",
      error,
    });
  },

  /**
   * Get a job by ID (user-scoped for security).
   */
  async getJob(
    jobId: string,
    userId: string
  ): Promise<AIProcessingJob | undefined> {
    return aiJobRepository.findByIdAndUser(jobId, userId);
  },

  /**
   * Get recent jobs for a user.
   */
  async getRecentJobs(
    userId: string,
    limit = 20
  ): Promise<AIProcessingJob[]> {
    return aiJobRepository.findRecentByUser(userId, limit);
  },
};
