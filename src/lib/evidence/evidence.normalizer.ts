/**
 * Evidence Normalizer — R1.4
 *
 * Converts raw `RevisionEventRecord` rows (with untyped JSONB
 * eventMetadata) into the typed `NormalizedEvidence` contract
 * that R2 will consume.
 *
 * This is a pure, stateless transformation. It:
 * - Extracts typed fields from eventMetadata JSONB
 * - Handles missing/legacy fields gracefully (null)
 * - Does NOT validate evidence quality
 * - Does NOT compute diagnostic scores
 * - Does NOT modify the source data
 *
 * @see evidence.types.ts for the output contract
 */

import type { RevisionEventRecord } from "@/types/database.types";
import { ALL_REPAIR_INTENTS } from "@/lib/repair/repair-request.builder";
import type { RepairIntent } from "@/lib/repair/repair-request.builder";
import type {
  NormalizedEvidence,
  EvidenceEventType,
  SelfAssessmentValue,
  StudentDifficulty,
  FailureReason,
  PostRepairUnderstanding,
} from "./evidence.types";

// ─── Helpers ────────────────────────────────────────────────

/** Safely extract a string field from untyped JSONB metadata. */
function metaString(meta: Record<string, unknown>, key: string): string | null {
  const val = meta[key];
  return typeof val === "string" ? val : null;
}

/** Safely extract a number field from untyped JSONB metadata. */
function metaNumber(meta: Record<string, unknown>, key: string): number | null {
  const val = meta[key];
  return typeof val === "number" ? val : null;
}

/** Safely extract a boolean field from untyped JSONB metadata. */
function metaBoolean(meta: Record<string, unknown>, key: string): boolean | null {
  const val = meta[key];
  return typeof val === "boolean" ? val : null;
}

/** Validate that a string is a known event type. Unknown types are explicit. */
function normalizeEventType(raw: string): EvidenceEventType {
  const known: EvidenceEventType[] = [
    "mcq_attempt", "self_assessment", "skip", "review", "initialize", "self_report",
    "repair_verification", "repair_understanding",
  ];
  return known.includes(raw as EvidenceEventType)
    ? (raw as EvidenceEventType)
    : "unknown";
}

/** Validate that a string is a known self-assessment value. */
function normalizeSelfAssessment(raw: string | null): SelfAssessmentValue | null {
  if (raw === "remembered" || raw === "partially" || raw === "forgot") {
    return raw;
  }
  return null;
}

/** Validate that a string is a known student difficulty value. */
function normalizeStudentDifficulty(raw: string | null): StudentDifficulty | null {
  const known: StudentDifficulty[] = [
    "concept_understanding", "memory_retrieval", "question_performance",
    "revision_need", "uncertain",
  ];
  return raw !== null && known.includes(raw as StudentDifficulty)
    ? (raw as StudentDifficulty)
    : null;
}

/** Validate that a string is a known failure reason value. */
function normalizeFailureReason(raw: string | null): FailureReason | null {
  const known: FailureReason[] = [
    "concept_not_understood", "could_not_recall", "misunderstood_question",
    "guessed", "overconfident", "careless_mistake", "not_sure",
  ];
  return raw !== null && known.includes(raw as FailureReason)
    ? (raw as FailureReason)
    : null;
}

/** Validate that a string is a known repair intent (R3.3). */
function normalizeRepairIntent(raw: string | null): RepairIntent | null {
  return raw !== null && ALL_REPAIR_INTENTS.includes(raw as RepairIntent)
    ? (raw as RepairIntent)
    : null;
}

/**
 * Validate that a string is a known post-repair understanding value (R3.3).
 *
 * Allowed-values list, so anything unrecognized — a legacy value, a typo, a
 * future value this build does not know — normalizes safely to null rather
 * than leaking an untyped string into the evidence contract.
 */
function normalizePostRepairUnderstanding(
  raw: string | null,
): PostRepairUnderstanding | null {
  const known: PostRepairUnderstanding[] = [
    "understood", "somewhat_unsure", "still_not_understood",
  ];
  return raw !== null && known.includes(raw as PostRepairUnderstanding)
    ? (raw as PostRepairUnderstanding)
    : null;
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Normalize a single raw revision event record into the R2 evidence contract.
 *
 * Handles all event types (mcq_attempt, self_assessment, skip, review)
 * and gracefully degrades for legacy events missing R1.2/R1.3 fields.
 */
export function normalizeEvent(record: RevisionEventRecord): NormalizedEvidence {
  // eventMetadata is JSONB — treat as untyped record
  const meta = (record.eventMetadata ?? {}) as Record<string, unknown>;

  return {
    // Identity
    eventId: record.id,
    userId: record.userId,
    conceptId: record.conceptId,
    timestamp: record.createdAt,

    // Event classification
    eventType: normalizeEventType(record.eventType),
    rawEventType: record.eventType,

    // SM-2 derived
    qualityRating: record.qualityRating ?? null,

    // MCQ top-level columns
    mcqCorrect: record.mcqCorrect ?? null,
    mcqQuestionIndex: record.mcqQuestionIndex ?? null,

    // MCQ evidence from eventMetadata (R1.2)
    questionId: metaString(meta, "questionId"),
    selectedAnswer: metaString(meta, "selectedAnswer"),
    correctAnswer: metaString(meta, "correctAnswer"),
    confidence: metaNumber(meta, "confidence"),

    // Revision evidence from eventMetadata (R1.3)
    selfAssessment: normalizeSelfAssessment(metaString(meta, "selfAssessment")),

    // Student self-report from eventMetadata (R2 Enhancement)
    studentDifficulty: normalizeStudentDifficulty(metaString(meta, "studentDifficulty")),

    // Failure reason from eventMetadata (Post-R2 Architecture)
    failureReason: normalizeFailureReason(metaString(meta, "failureReason")),

    // Repair verification evidence from eventMetadata (R3.3)
    repairRequestId: metaString(meta, "requestId"),
    repairIntent: normalizeRepairIntent(metaString(meta, "repairIntent")),
    verificationCorrect: metaBoolean(meta, "verificationCorrect"),

    // Post-repair understanding from eventMetadata (R3.3).
    // Student-reported only — never inferred from any other field here.
    postRepairUnderstanding: normalizePostRepairUnderstanding(
      metaString(meta, "postRepairUnderstanding"),
    ),

    // Mastery transition metadata
    previousInterval: metaNumber(meta, "previousInterval"),
    newInterval: metaNumber(meta, "newInterval"),
    previousEase: metaNumber(meta, "previousEase"),
    newEase: metaNumber(meta, "newEase"),

    // Skip metadata
    skipCount: metaNumber(meta, "skipCount"),
  };
}

/**
 * Normalize a batch of raw revision event records.
 * Preserves the input order (caller should sort before calling).
 */
export function normalizeEvents(records: RevisionEventRecord[]): NormalizedEvidence[] {
  return records.map(normalizeEvent);
}
