/**
 * Evidence module — R1.4
 *
 * Read-only normalization boundary between raw revision_events
 * and the future R2 Diagnostic Engine.
 *
 * Usage:
 *   import { normalizeEvent, normalizeEvents } from "@/lib/evidence";
 *   import type { NormalizedEvidence, ConceptEvidenceSequence } from "@/lib/evidence";
 */

export { normalizeEvent, normalizeEvents } from "./evidence.normalizer";

export type {
  NormalizedEvidence,
  EvidenceEventType,
  SelfAssessmentValue,
  StudentDifficulty,
  FailureReason,
  PostRepairUnderstanding,
  EvidenceQueryParams,
  ConceptEvidenceSequence,
} from "./evidence.types";
