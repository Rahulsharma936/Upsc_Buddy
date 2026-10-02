/**
 * Diagnostic Service — R2.5
 *
 * Orchestrates the diagnostic pipeline:
 *   Evidence Retrieval → Normalization → Feature Extraction → Diagnosis
 *
 * This service is the single integration point between the DB
 * (revision repository) and the pure diagnostic engine.
 * All diagnostic logic lives in the engine — this service only wires the pipeline.
 *
 * @see diagnostic.engine.ts — scoring logic
 * @see feature.extractor.ts — feature extraction
 * @see evidence.normalizer.ts — event normalization
 */

import { revisionRepository } from "@/lib/repositories/revision.repository";
import { normalizeEvents } from "@/lib/evidence/evidence.normalizer";
import { extractFeatures } from "@/lib/diagnostic/feature.extractor";
import { diagnose } from "@/lib/diagnostic/diagnostic.engine";
import type { ConceptDiagnosticReport } from "@/lib/diagnostic/diagnostic.types";
import type { ConceptFeatures } from "@/lib/diagnostic/feature.types";

// ─── Response Types ─────────────────────────────────────────

/** Single concept diagnostic response. */
export interface ConceptDiagnosticResponse {
  report: ConceptDiagnosticReport;
  features: ConceptFeatures;
}

/** Overview: one concept's summary for the overview endpoint. */
export interface DiagnosticSummaryItem {
  conceptId: string;
  primaryDiagnosis: string | null;
  primaryScore: number;
  activeDiagnosisCount: number;
  evidenceCount: number;
}

/** Overview endpoint response. */
export interface DiagnosticOverviewResponse {
  totalConcepts: number;
  conceptsWithDiagnosis: number;
  byDiagnosis: {
    concept_gap: string[];
    memory_gap: string[];
    calibration_gap: string[];
    revision_gap: string[];
  };
  highestPriority: DiagnosticSummaryItem[];
  summary: DiagnosticSummaryItem[];
  generatedAt: string;
}

// ─── Service ────────────────────────────────────────────────

export const diagnosticService = {
  /**
   * Run diagnostic for a single concept.
   *
   * Pipeline: getConceptHistory → normalize → extractFeatures → diagnose
   */
  async diagnoseConceptForUser(
    userId: string,
    conceptId: string
  ): Promise<ConceptDiagnosticResponse> {
    const now = new Date();

    // 1. Retrieve raw events
    const rawEvents = await revisionRepository.getConceptHistory(userId, conceptId);

    // 2. Normalize
    const normalized = normalizeEvents(rawEvents);

    // 3. Extract features
    const features = extractFeatures(normalized, now);

    // 4. Run diagnostic engine
    const report = diagnose(features, now);

    return { report, features };
  },

  /**
   * Run diagnostics across all concepts for a user.
   *
   * Uses getEventsByUser to fetch all events in one query,
   * then groups by concept and runs the pipeline per concept.
   */
  async diagnoseOverviewForUser(
    userId: string
  ): Promise<DiagnosticOverviewResponse> {
    const now = new Date();

    // 1. Retrieve all events for user (single query)
    const rawEvents = await revisionRepository.getEventsByUser(userId, 500);

    // 2. Normalize all
    const normalized = normalizeEvents(rawEvents);

    // 3. Group by concept
    const byConceptMap = new Map<string, typeof normalized>();
    for (const ev of normalized) {
      const arr = byConceptMap.get(ev.conceptId) ?? [];
      arr.push(ev);
      byConceptMap.set(ev.conceptId, arr);
    }

    // 4. Run pipeline per concept
    const summaries: DiagnosticSummaryItem[] = [];
    const byDiagnosis: DiagnosticOverviewResponse["byDiagnosis"] = {
      concept_gap: [],
      memory_gap: [],
      calibration_gap: [],
      revision_gap: [],
    };

    for (const [conceptId, events] of byConceptMap) {
      const features = extractFeatures(events, now);
      const report = diagnose(features, now);

      const item: DiagnosticSummaryItem = {
        conceptId,
        primaryDiagnosis: report.primaryDiagnosis?.type ?? null,
        primaryScore: report.primaryDiagnosis?.score ?? 0,
        activeDiagnosisCount: report.diagnoses.filter((d) => d.active).length,
        evidenceCount: report.evidenceCount,
      };

      summaries.push(item);

      // Group concept into its primary diagnosis bucket
      if (report.primaryDiagnosis) {
        const bucket = byDiagnosis[report.primaryDiagnosis.type];
        if (bucket) bucket.push(conceptId);
      }
    }

    // 5. Sort by priority: highest primary score first
    const sorted = [...summaries].sort((a, b) => b.primaryScore - a.primaryScore);
    const highestPriority = sorted.filter((s) => s.activeDiagnosisCount > 0).slice(0, 10);

    return {
      totalConcepts: summaries.length,
      conceptsWithDiagnosis: summaries.filter((s) => s.activeDiagnosisCount > 0).length,
      byDiagnosis,
      highestPriority,
      summary: sorted,
      generatedAt: now.toISOString(),
    };
  },
};
