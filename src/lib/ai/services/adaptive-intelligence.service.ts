/**
 * Adaptive Intelligence Service — Phase 4.
 *
 * Orchestrates all adaptive engines and persists computed intelligence.
 *
 * Flow:
 * 1. Load all user data (concepts, mastery, mappings)
 * 2. Run pure-function engines (subject strengths, coverage, gaps, patterns)
 * 3. Generate recommendations
 * 4. Persist adaptive profile
 *
 * No AI calls — 100% deterministic and explainable.
 */

import { conceptRepository } from "@/lib/repositories/concept.repository";
import { revisionRepository } from "@/lib/repositories/revision.repository";
import { conceptContextRepository } from "@/lib/repositories/concept-context.repository";
import { adaptiveProfileRepository } from "@/lib/repositories/adaptive-profile.repository";
import { flattenSyllabus } from "@/lib/db/seeds/seeds";
import {
  computeSubjectStrengths,
  computeSyllabusCoverage,
  detectConceptGaps,
  analyzeStudyPatterns,
  computeSubjectWeaknesses,
  generateRecommendations,
  computeAdaptiveDifficulty,
  type SubjectStrength,
  type PaperCoverage,
  type ConceptGap,
  type StudyPatterns,
  type SubjectWeakness,
  type AdaptiveRecommendation,
} from "./adaptive-intelligence.engine";
import type { LearnerAdaptiveProfileRecord } from "@/types/database.types";

// ─── Staleness threshold: recompute if older than 1 hour ────
const STALENESS_THRESHOLD_MS = 60 * 60 * 1000;

// ─── Types ──────────────────────────────────────────────────

export interface AdaptiveIntelligenceResult {
  subjectStrengths: SubjectStrength[];
  syllabusCoverage: PaperCoverage[];
  conceptGaps: ConceptGap[];
  studyPatterns: StudyPatterns;
  subjectWeaknesses: SubjectWeakness[];
  recommendations: AdaptiveRecommendation[];
  computedAt: string;
  stats: {
    totalConcepts: number;
    totalMasteryRecords: number;
    totalMappedSubtopics: number;
    computationTimeMs: number;
  };
}

// ─── Service ────────────────────────────────────────────────

export const adaptiveIntelligenceService = {
  /**
   * Compute or retrieve adaptive intelligence for a user.
   * Uses staleness check to avoid unnecessary recomputation.
   */
  async getAdaptiveIntelligence(params: {
    userId: string;
    force?: boolean;
  }): Promise<AdaptiveIntelligenceResult> {
    // Check for cached, non-stale profile (table may not exist yet)
    if (!params.force) {
      try {
        const existing = await adaptiveProfileRepository.findByUser(params.userId);
        if (existing && !isStale(existing.lastComputedAt)) {
          console.log("[ADAPTIVE] Returning cached profile");
          return deserializeProfile(existing);
        }
      } catch {
        // Table not created yet — compute fresh
      }
    }

    return this.computeAndPersist(params.userId);
  },

  /**
   * Force recompute adaptive intelligence.
   */
  async computeAndPersist(userId: string): Promise<AdaptiveIntelligenceResult> {
    const startTime = Date.now();
    console.log("[ADAPTIVE] Computing adaptive intelligence");

    // ─── Step 1: Load all user data ──────────────────────
    const concepts = await conceptRepository.findByUser(userId, 500);

    // Mastery may not exist yet (table not created)
    let allMastery: Awaited<ReturnType<typeof revisionRepository.getAllMastery>> = [];
    try {
      allMastery = await revisionRepository.getAllMastery(userId);
    } catch {
      console.log("[ADAPTIVE] concept_mastery table not available — using empty mastery");
    }

    console.log("[ADAPTIVE] Data loaded:", {
      concepts: concepts.length,
      masteryRecords: allMastery.length,
    });

    // ─── Step 2: Compute mapped subtopics for coverage ───
    const mappedSubtopics = new Set<string>();
    const conceptIds = concepts.map((c) => c.id);

    // Load context intelligence (table may not exist yet)
    if (conceptIds.length > 0) {
      try {
        const contextRecords = await conceptContextRepository.findByConceptIds(conceptIds);
        for (const ctx of contextRecords) {
          const mappings = (ctx.gsMappings as any[]) ?? [];
          for (const m of mappings) {
            if (m.subtopic) mappedSubtopics.add(m.subtopic.toLowerCase());
          }
        }
      } catch {
        console.log("[ADAPTIVE] concept_context_intelligence table not available");
      }
    }

    // ─── Step 3: Run engines ─────────────────────────────
    const ontologyNodes = flattenSyllabus();

    const subjectStrengths = computeSubjectStrengths(concepts, allMastery);
    const syllabusCoverage = computeSyllabusCoverage(ontologyNodes, mappedSubtopics);
    const conceptGaps = detectConceptGaps(syllabusCoverage, subjectStrengths);
    const studyPatterns = analyzeStudyPatterns(concepts);
    const subjectWeaknesses = computeSubjectWeaknesses(subjectStrengths, allMastery);

    const recommendations = generateRecommendations({
      strengths: subjectStrengths,
      weaknesses: subjectWeaknesses,
      gaps: conceptGaps,
      patterns: studyPatterns,
      coverage: syllabusCoverage,
    });

    const computationTimeMs = Date.now() - startTime;

    console.log("[ADAPTIVE] Engines complete:", {
      strengths: subjectStrengths.length,
      coverage: syllabusCoverage.length,
      gaps: conceptGaps.length,
      weaknesses: subjectWeaknesses.length,
      recommendations: recommendations.length,
      timeMs: computationTimeMs,
    });

    // ─── Step 4: Persist (table may not exist yet) ───────
    try {
      await adaptiveProfileRepository.upsert({
        userId,
        subjectStrengths,
        syllabusCoverage,
        conceptGaps,
        studyPatterns,
        subjectWeaknesses,
        recommendations,
        computationMetadata: {
          totalConcepts: concepts.length,
          totalMasteryRecords: allMastery.length,
          totalMappedSubtopics: mappedSubtopics.size,
          computationTimeMs,
        },
        lastComputedAt: new Date(),
      });
      console.log("[ADAPTIVE] Profile persisted");
    } catch {
      console.log("[ADAPTIVE] Could not persist profile — table may not exist");
    }

    return {
      subjectStrengths,
      syllabusCoverage,
      conceptGaps,
      studyPatterns,
      subjectWeaknesses,
      recommendations,
      computedAt: new Date().toISOString(),
      stats: {
        totalConcepts: concepts.length,
        totalMasteryRecords: allMastery.length,
        totalMappedSubtopics: mappedSubtopics.size,
        computationTimeMs,
      },
    };
  },

  /**
   * Get adaptive difficulty for a specific concept.
   */
  async getAdaptiveDifficulty(params: {
    userId: string;
    conceptId: string;
  }): Promise<{ recommended: "easy" | "moderate" | "hard"; reason: string }> {
    try {
      const mastery = await revisionRepository.getMastery(params.userId, params.conceptId);

      if (!mastery) {
        return { recommended: "moderate", reason: "No mastery data — default difficulty" };
      }

      return computeAdaptiveDifficulty(
        mastery.masteryLevel,
        Number(mastery.confidenceScore),
        mastery.correctCount,
        mastery.incorrectCount
      );
    } catch {
      return { recommended: "moderate", reason: "Mastery data unavailable — default difficulty" };
    }
  },
};

// ─── Helpers ────────────────────────────────────────────────

function isStale(lastComputedAt: Date): boolean {
  return Date.now() - lastComputedAt.getTime() > STALENESS_THRESHOLD_MS;
}

function deserializeProfile(record: LearnerAdaptiveProfileRecord): AdaptiveIntelligenceResult {
  return {
    subjectStrengths: (record.subjectStrengths as SubjectStrength[]) ?? [],
    syllabusCoverage: (record.syllabusCoverage as PaperCoverage[]) ?? [],
    conceptGaps: (record.conceptGaps as ConceptGap[]) ?? [],
    studyPatterns: (record.studyPatterns as StudyPatterns) ?? {},
    subjectWeaknesses: (record.subjectWeaknesses as SubjectWeakness[]) ?? [],
    recommendations: (record.recommendations as AdaptiveRecommendation[]) ?? [],
    computedAt: record.lastComputedAt.toISOString(),
    stats: (record.computationMetadata as any) ?? {},
  };
}
