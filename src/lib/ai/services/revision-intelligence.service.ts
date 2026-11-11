/**
 * Revision Intelligence Service — Phase 3C.
 *
 * Orchestrates:
 * - Review event processing (SM-2 state transitions)
 * - Revision schedule queries
 * - Priority-ranked recommendations
 * - Weak area reporting
 * - Revision analytics
 *
 * No AI calls — fully deterministic.
 */

import type { ContentScope } from "@/lib/content-scope";
import { revisionRepository } from "@/lib/repositories/revision.repository";
import { conceptRepository } from "@/lib/repositories/concept.repository";
import { conceptContextRepository } from "@/lib/repositories/concept-context.repository";
import { pyqMatchRepository } from "@/lib/repositories/pyq-match.repository";
import { relationshipRepository } from "@/lib/repositories/relationship.repository";
import {
  calculateNextState,
  handleSkip,
  initializeMastery,
  calculateRevisionPriority,
  estimateForgettingProbability,
  type MasteryState,
} from "./spaced-repetition.engine";
import type { ConceptMasteryRecord } from "@/types/database.types";

// ─── Helpers ────────────────────────────────────────────────

/** Convert a DB record to the pure MasteryState expected by the SM-2 engine. */
function hydrateMasteryState(record: ConceptMasteryRecord): MasteryState {
  return {
    easeFactor: Number(record.easeFactor),
    intervalDays: record.intervalDays,
    repetitionCount: record.repetitionCount,
    masteryLevel: record.masteryLevel as MasteryState["masteryLevel"],
    confidenceScore: Number(record.confidenceScore),
    correctCount: record.correctCount,
    incorrectCount: record.incorrectCount,
    skipCount: record.skipCount,
    isWeakArea: record.isWeakArea,
    weakSignals: (record.weakSignals as string[]) ?? [],
  };
}

// ─── Types ──────────────────────────────────────────────────

export interface RevisionRecommendation {
  conceptId: string;
  conceptName: string;
  subject: string;
  masteryLevel: string;
  priorityScore: number;
  forgettingProbability: number;
  isWeakArea: boolean;
  daysSinceReview: number | null;
  daysOverdue: number;
  intervalDays: number;
  signals: Record<string, number>;
}

export interface RevisionStats {
  totalConcepts: number;
  mastered: number;
  reviewing: number;
  learning: number;
  unseen: number;
  weakAreas: number;
  dueNow: number;
  averageConfidence: number;
}

// ─── Service ────────────────────────────────────────────────

export const revisionIntelligenceService = {
  /**
   * Record a review event and update mastery state.
   */
  async recordReview(params: {
    userId: string;
    conceptId: string;
    quality: number;
    eventType: "review" | "mcq_attempt" | "self_assessment";
    mcqCorrect?: boolean;
    mcqQuestionIndex?: number;
    // R1.2 MCQ evidence — optional, does NOT affect SM-2
    mcqQuestionId?: string;
    selectedAnswer?: string;
    correctAnswer?: string;
    confidence?: number;
    // R1.3 Revision evidence — raw self-assessment, separate from derived quality
    selfAssessment?: "remembered" | "partially" | "forgot";
    // Post-R2: student's authoritative failure reason for wrong MCQ
    failureReason?: string;
    // Written answer (typed or photographed), marked by /api/answer/evaluate;
    // the caller already mapped the mark onto `quality`.
    writtenScore?: number;
    writtenMaxScore?: number;
    answerSource?: "typed" | "photo" | "both" | "voice";
    answerMode?: "recall" | "mains" | "interview";
    mainsQuestionIndex?: number;
    answerExcerpt?: string;
  }): Promise<{
    mastery: ConceptMasteryRecord;
    nextReviewAt: Date;
    intervalDays: number;
  }> {
    console.log("[REVISION] Recording review:", {
      conceptId: params.conceptId,
      quality: params.quality,
      eventType: params.eventType,
    });

    // Get or initialize mastery state
    const existing = await revisionRepository.getMastery(params.userId, params.conceptId);
    const currentState: MasteryState = existing
      ? hydrateMasteryState(existing)
      : initializeMastery();

    // Calculate next state — SM-2 only sees quality, NOT confidence/selectedAnswer/selfAssessment
    const result = calculateNextState(currentState, params.quality);

    // Build eventMetadata — existing SM-2 transition fields + R1.2/R1.3 evidence
    const eventMetadata: Record<string, unknown> = {
      previousInterval: currentState.intervalDays,
      newInterval: result.intervalDays,
      previousEase: currentState.easeFactor,
      newEase: result.nextState.easeFactor,
    };

    // R1.2: Additive MCQ evidence — only included when present
    if (params.mcqQuestionId !== undefined) eventMetadata.questionId = params.mcqQuestionId;
    if (params.selectedAnswer !== undefined) eventMetadata.selectedAnswer = params.selectedAnswer;
    if (params.correctAnswer !== undefined) eventMetadata.correctAnswer = params.correctAnswer;
    if (params.confidence !== undefined) eventMetadata.confidence = params.confidence;
    // R1.3: Raw revision self-assessment — stored separately from derived SM-2 quality
    if (params.selfAssessment !== undefined) eventMetadata.selfAssessment = params.selfAssessment;
    // Post-R2: Student's authoritative failure reason — stored for R3 consumption
    if (params.failureReason !== undefined) eventMetadata.failureReason = params.failureReason;
    // Written-answer evidence — additive, never read by SM-2
    if (params.writtenScore !== undefined) eventMetadata.writtenScore = params.writtenScore;
    if (params.writtenMaxScore !== undefined) eventMetadata.writtenMaxScore = params.writtenMaxScore;
    if (params.answerSource !== undefined) eventMetadata.answerSource = params.answerSource;
    if (params.answerMode !== undefined) eventMetadata.answerMode = params.answerMode;
    if (params.mainsQuestionIndex !== undefined) eventMetadata.mainsQuestionIndex = params.mainsQuestionIndex;
    if (params.answerExcerpt !== undefined) eventMetadata.answerExcerpt = params.answerExcerpt.slice(0, 300);

    // Log event
    await revisionRepository.logEvent({
      userId: params.userId,
      conceptId: params.conceptId,
      eventType: params.eventType,
      qualityRating: params.quality,
      mcqCorrect: params.mcqCorrect,
      mcqQuestionIndex: params.mcqQuestionIndex,
      eventMetadata,
    });

    // Persist mastery state
    const mastery = await revisionRepository.upsertMastery({
      userId: params.userId,
      conceptId: params.conceptId,
      easeFactor: String(result.nextState.easeFactor),
      intervalDays: result.nextState.intervalDays,
      repetitionCount: result.nextState.repetitionCount,
      masteryLevel: result.nextState.masteryLevel,
      confidenceScore: String(result.nextState.confidenceScore),
      lastReviewedAt: new Date(),
      nextReviewAt: result.nextReviewAt,
      correctCount: result.nextState.correctCount,
      incorrectCount: result.nextState.incorrectCount,
      skipCount: result.nextState.skipCount,
      isWeakArea: result.nextState.isWeakArea,
      weakSignals: result.nextState.weakSignals,
    });

    console.log("[REVISION] State updated:", {
      mastery: result.nextState.masteryLevel,
      interval: result.intervalDays,
      nextReview: result.nextReviewAt.toISOString(),
    });

    return {
      mastery,
      nextReviewAt: result.nextReviewAt,
      intervalDays: result.intervalDays,
    };
  },

  /**
   * Record a skipped revision.
   */
  async recordSkip(params: {
    userId: string;
    conceptId: string;
  }): Promise<ConceptMasteryRecord> {
    const existing = await revisionRepository.getMastery(params.userId, params.conceptId);
    const currentState: MasteryState = existing
      ? hydrateMasteryState(existing)
      : initializeMastery();

    const result = handleSkip(currentState);

    await revisionRepository.logEvent({
      userId: params.userId,
      conceptId: params.conceptId,
      eventType: "skip",
      eventMetadata: { skipCount: result.nextState.skipCount },
    });

    return revisionRepository.upsertMastery({
      userId: params.userId,
      conceptId: params.conceptId,
      easeFactor: String(result.nextState.easeFactor),
      intervalDays: result.nextState.intervalDays,
      repetitionCount: result.nextState.repetitionCount,
      masteryLevel: result.nextState.masteryLevel,
      confidenceScore: String(result.nextState.confidenceScore),
      lastReviewedAt: existing?.lastReviewedAt ?? null,
      nextReviewAt: result.nextReviewAt,
      correctCount: result.nextState.correctCount,
      incorrectCount: result.nextState.incorrectCount,
      skipCount: result.nextState.skipCount,
      isWeakArea: result.nextState.isWeakArea,
      weakSignals: result.nextState.weakSignals,
    });
  },

  /**
   * Get priority-ranked revision recommendations.
   * Returns concepts that need revision, scored and sorted.
   */
  async getRecommendations(params: {
    userId: string;
    limit?: number;
    /** Only static-syllabus or only current-affairs concepts (default: all). */
    scope?: ContentScope;
  }): Promise<RevisionRecommendation[]> {
    const limit = params.limit ?? 15;

    // Get all due concepts
    const dueRecords = await revisionRepository.getDueForRevision(params.userId, limit * 2, params.scope ?? "all");

    if (dueRecords.length === 0) return [];

    // Enrich with concept data and score
    const recommendations: RevisionRecommendation[] = [];

    // Batch enrichment: four queries for the whole due set instead of four
    // per concept (this loop used to cost ~200 sequential round trips).
    const dueIds = dueRecords.map((r) => r.conceptId);
    const dueIdSet = new Set(dueIds);
    const [conceptRows, contextRows, pyqRows, relationshipRows] = await Promise.all([
      conceptRepository.findByIds(dueIds),
      conceptContextRepository.findByConceptIds(dueIds),
      pyqMatchRepository.findByConcepts(dueIds),
      relationshipRepository.findByConcepts(dueIds),
    ]);
    const conceptById = new Map(conceptRows.map((c) => [c.id, c]));
    const hasContext = new Set(contextRows.map((c) => c.conceptId));
    const pyqCountByConcept = new Map<string, number>();
    for (const m of pyqRows) pyqCountByConcept.set(m.conceptId, (pyqCountByConcept.get(m.conceptId) ?? 0) + 1);
    const relationshipCountByConcept = new Map<string, number>();
    for (const r of relationshipRows) {
      for (const id of [r.sourceConceptId, r.targetConceptId]) {
        if (dueIdSet.has(id)) relationshipCountByConcept.set(id, (relationshipCountByConcept.get(id) ?? 0) + 1);
      }
    }

    for (const record of dueRecords) {
      const concept = conceptById.get(record.conceptId);
      if (!concept) continue;

      const mastery: MasteryState = hydrateMasteryState(record);

      const priority = calculateRevisionPriority({
        mastery,
        lastReviewedAt: record.lastReviewedAt,
        nextReviewAt: record.nextReviewAt,
        extractionConfidence: concept.extractionConfidence,
        hasGSMapping: hasContext.has(record.conceptId),
        hasPYQMatch: (pyqCountByConcept.get(record.conceptId) ?? 0) > 0,
        relationshipCount: relationshipCountByConcept.get(record.conceptId) ?? 0,
      });

      const forgettingProb = estimateForgettingProbability(
        record.lastReviewedAt,
        record.intervalDays,
        Number(record.easeFactor)
      );

      const now = Date.now();
      const daysSinceReview = record.lastReviewedAt
        ? Math.floor((now - record.lastReviewedAt.getTime()) / (1000 * 60 * 60 * 24))
        : null;

      const daysOverdue = record.nextReviewAt
        ? Math.max(0, Math.floor((now - record.nextReviewAt.getTime()) / (1000 * 60 * 60 * 24)))
        : 0;

      recommendations.push({
        conceptId: record.conceptId,
        conceptName: concept.displayName,
        subject: concept.subject,
        masteryLevel: record.masteryLevel,
        priorityScore: priority.score,
        forgettingProbability: forgettingProb,
        isWeakArea: record.isWeakArea,
        daysSinceReview,
        daysOverdue,
        intervalDays: record.intervalDays,
        signals: priority.signals,
      });
    }

    // Sort by priority (highest first)
    recommendations.sort((a, b) => b.priorityScore - a.priorityScore);

    return recommendations.slice(0, limit);
  },

  /**
   * Get revision analytics for a user.
   */
  async getStats(userId: string, scope: ContentScope = "all"): Promise<RevisionStats> {
    const allMastery = await revisionRepository.getAllMastery(userId, scope);
    const now = new Date();

    const stats: RevisionStats = {
      totalConcepts: allMastery.length,
      mastered: 0,
      reviewing: 0,
      learning: 0,
      unseen: 0,
      weakAreas: 0,
      dueNow: 0,
      averageConfidence: 0,
    };

    let confidenceSum = 0;

    for (const m of allMastery) {
      switch (m.masteryLevel) {
        case "mastered": stats.mastered++; break;
        case "reviewing": stats.reviewing++; break;
        case "learning": stats.learning++; break;
        default: stats.unseen++;
      }

      if (m.isWeakArea) stats.weakAreas++;
      if (m.nextReviewAt && m.nextReviewAt <= now) stats.dueNow++;
      confidenceSum += Number(m.confidenceScore);
    }

    stats.averageConfidence = allMastery.length > 0
      ? Math.round((confidenceSum / allMastery.length) * 100) / 100
      : 0;

    return stats;
  },

  /**
   * Get weak areas with details.
   */
  async getWeakAreas(userId: string): Promise<{
    conceptId: string;
    conceptName: string;
    subject: string;
    weakSignals: string[];
    confidenceScore: number;
    incorrectCount: number;
    skipCount: number;
  }[]> {
    const weakRecords = await revisionRepository.getWeakAreas(userId);
    const results = [];

    for (const record of weakRecords) {
      const concept = await conceptRepository.findById(record.conceptId);
      if (!concept) continue;

      results.push({
        conceptId: record.conceptId,
        conceptName: concept.displayName,
        subject: concept.subject,
        weakSignals: (record.weakSignals as string[]) ?? [],
        confidenceScore: Number(record.confidenceScore),
        incorrectCount: record.incorrectCount,
        skipCount: record.skipCount,
      });
    }

    return results;
  },

  /**
   * Initialize mastery for a concept (called after concept extraction).
   */
  async initializeForConcept(params: {
    userId: string;
    conceptId: string;
  }): Promise<ConceptMasteryRecord> {
    const existing = await revisionRepository.getMastery(params.userId, params.conceptId);
    if (existing) return existing;

    const initial = initializeMastery();
    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + 1); // First review: tomorrow

    return revisionRepository.upsertMastery({
      userId: params.userId,
      conceptId: params.conceptId,
      easeFactor: String(initial.easeFactor),
      intervalDays: initial.intervalDays,
      repetitionCount: initial.repetitionCount,
      masteryLevel: initial.masteryLevel,
      confidenceScore: String(initial.confidenceScore),
      lastReviewedAt: null,
      nextReviewAt: nextReview,
      correctCount: initial.correctCount,
      incorrectCount: initial.incorrectCount,
      skipCount: initial.skipCount,
      isWeakArea: initial.isWeakArea,
      weakSignals: initial.weakSignals,
    });
  },
};
