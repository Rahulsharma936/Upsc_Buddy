/**
 * R3.3 — Post-Repair Student Self-Assessment
 *
 * Persists what the student SAYS about a concept after a repair was delivered
 * and its verification MCQ answered.
 *
 * Pipeline position:
 *   R3.1 RepairRequest → R3.2 Repair (+ verification MCQ)
 *   → student answers → R3.3 repair_verification
 *   → student self-reports → R3.3 buildRepairUnderstandingEvent()
 *   → revision_events (event_type = "repair_understanding")
 *   → R3.4 re-diagnosis (future)
 *
 * This module is PURE: no DB, no AI, no side effects. The API route supplies
 * auth/ownership, reads the stored verification event, and performs the single
 * append-only write.
 *
 * What this is:
 *   A raw, student-reported categorical fact. Nothing more.
 *
 * What this is NOT:
 *   - NOT a score. The three values are opaque categories with no ordering
 *     and no numeric mapping. There is deliberately no 1-3 confidence scale.
 *   - NOT a resolution verdict. No `resolved`, `status`, effectiveness score,
 *     or composite index is computed here or anywhere downstream yet.
 *   - NOT inferred. The system never derives this from verificationCorrect,
 *     from MCQ accuracy, or from any diagnostic computation.
 *
 * Architectural guarantees:
 *   - Does NOT touch SM-2. The produced event carries qualityRating: null and
 *     mcqCorrect: null so it can never enter a scheduling calculation or
 *     contaminate R2's MCQ accuracy features.
 *   - Does NOT use the legacy `src/lib/diagnostic/` scoring system.
 *   - The client sends ONLY { requestId, postRepairUnderstanding }. Every
 *     other stored field is DERIVED server-side from the already-persisted
 *     repair_verification event — never taken from the client.
 *   - The R3.1 `requestId` is preserved verbatim, so the repair, its
 *     verification, and this self-report all stay correlated under one id.
 *     No second identifier is introduced.
 *
 * @see repair-request.builder.ts (R3.1)
 * @see concept-teaching.executor.ts (R3.2a)
 * @see repair-verification.ts (R3.3 verification, the source of derivation)
 */

import { z } from "zod";
import type {
  FailureReason,
  PostRepairUnderstanding,
} from "@/lib/evidence/evidence.types";
import { ALL_FAILURE_REASONS, ALL_REPAIR_INTENTS } from "./repair-request.builder";
import type { RepairIntent } from "./repair-request.builder";

// ─── Constants ──────────────────────────────────────────────

/**
 * The `revision_events.event_type` value for a post-repair self-assessment.
 * Uses the existing table and existing JSONB metadata mechanism —
 * no new table, no migration, no schema change.
 *
 * A SEPARATE append-only event: the `repair_verification` row recorded
 * earlier is never read back for modification, never updated.
 */
export const REPAIR_UNDERSTANDING_EVENT_TYPE = "repair_understanding";

/**
 * The three values a student may report, in the order they are presented.
 *
 * Order is presentational only — these carry no rank, no score, and no
 * implied "better"/"worse".
 */
export const ALL_POST_REPAIR_UNDERSTANDING: readonly PostRepairUnderstanding[] = [
  "understood",
  "somewhat_unsure",
  "still_not_understood",
];

// ─── Payload Schema ─────────────────────────────────────────

const postRepairUnderstandingSchema = z.enum(
  ALL_POST_REPAIR_UNDERSTANDING as unknown as [
    PostRepairUnderstanding,
    ...PostRepairUnderstanding[],
  ],
);

/**
 * The accepted `POST /api/repair/understanding` request body.
 *
 * Deliberately minimal: the requestId identifies the repair, and the value is
 * the student's answer. That is the whole trusted surface.
 *
 * `.strict()` — unknown client-supplied fields are rejected outright rather
 * than being silently carried into the stored evidence. In particular this
 * rejects `conceptId`, `failureReason`, `repairIntent` (all server-derived),
 * `verificationCorrect` (belongs to the verification event), and any SM-2
 * field such as `qualityRating`.
 */
export const repairUnderstandingPayloadSchema = z
  .object({
    /** The R3.1 requestId of the repair being reported on. Must survive intact. */
    requestId: z.uuid(),
    /** The student's own report. Stored verbatim, never reinterpreted. */
    postRepairUnderstanding: postRepairUnderstandingSchema,
  })
  .strict();

export type RepairUnderstandingPayload = z.infer<
  typeof repairUnderstandingPayloadSchema
>;

// ─── Derived Repair Context ─────────────────────────────────

/**
 * The facts the server recovers from the stored `repair_verification` event.
 * The client is never consulted for any of these.
 */
export interface DerivedRepairContext {
  conceptId: string;
  failureReason: FailureReason;
  repairIntent: RepairIntent;
}

export type RepairContextDerivation =
  | { success: true; context: DerivedRepairContext }
  | { success: false; error: string };

/** Read a string field out of untyped JSONB metadata. */
function metaString(meta: Record<string, unknown>, key: string): string | null {
  const val = meta[key];
  return typeof val === "string" && val.length > 0 ? val : null;
}

/**
 * Derive conceptId / failureReason / repairIntent from an already-persisted
 * repair_verification event.
 *
 * This is the anti-tamper boundary: the student's browser cannot assert which
 * concept the repair was about, what they originally said went wrong, or which
 * intent ran. Those were recorded server-side at verification time and are
 * simply read back here.
 *
 * @param verificationMetadata - The stored event's JSONB metadata (untrusted shape)
 * @param fallbackConceptId - The verification row's own conceptId column, used
 *   when the metadata predates the field. Also server-side data.
 */
export function deriveRepairContext(
  verificationMetadata: unknown,
  fallbackConceptId?: string | null,
): RepairContextDerivation {
  const meta =
    verificationMetadata && typeof verificationMetadata === "object"
      ? (verificationMetadata as Record<string, unknown>)
      : {};

  const conceptId = metaString(meta, "conceptId") ?? fallbackConceptId ?? null;
  if (!conceptId) {
    return {
      success: false,
      error: "Stored repair verification is missing its conceptId",
    };
  }

  const failureReason = metaString(meta, "failureReason");
  if (
    failureReason === null ||
    !ALL_FAILURE_REASONS.includes(failureReason as FailureReason)
  ) {
    return {
      success: false,
      error: "Stored repair verification has no recognizable failureReason",
    };
  }

  const repairIntent = metaString(meta, "repairIntent");
  if (
    repairIntent === null ||
    !ALL_REPAIR_INTENTS.includes(repairIntent as RepairIntent)
  ) {
    return {
      success: false,
      error: "Stored repair verification has no recognizable repairIntent",
    };
  }

  return {
    success: true,
    context: {
      conceptId,
      failureReason: failureReason as FailureReason,
      repairIntent: repairIntent as RepairIntent,
    },
  };
}

// ─── Stored Evidence Shape ──────────────────────────────────

/**
 * The exact JSONB written to `revision_events.event_metadata`.
 *
 * Note what is absent, deliberately: no `verificationCorrect`, no
 * `qualityRating`, no `mcqCorrect`, no `resolved`, no `status`, no score of
 * any kind. The verification outcome lives on its own event; keeping the two
 * facts unjoined here is what stops this from becoming a hidden diagnosis.
 */
export interface RepairUnderstandingMetadata {
  /** R3.1 requestId — correlates this report to its repair and verification. */
  requestId: string;
  /** Concept the repair targeted. Derived. Mirrors the top-level column. */
  conceptId: string;
  /** Student's original self-reported cause. Derived from the verification. */
  failureReason: FailureReason;
  /** The intent that was executed. Derived from the verification. */
  repairIntent: RepairIntent;
  /** The student's report, stored exactly as they gave it. */
  postRepairUnderstanding: PostRepairUnderstanding;
  /** Server-generated ISO timestamp of the report. */
  reportedAt: string;
}

/**
 * A ready-to-insert `revision_events` row for a post-repair self-assessment.
 *
 * `qualityRating`, `mcqCorrect` and `mcqQuestionIndex` are pinned to null so
 * this row is inert with respect to SM-2 and to R2's MCQ-derived features.
 */
export interface RepairUnderstandingEvent {
  eventType: typeof REPAIR_UNDERSTANDING_EVENT_TYPE;
  qualityRating: null;
  mcqCorrect: null;
  mcqQuestionIndex: null;
  eventMetadata: RepairUnderstandingMetadata;
}

// ─── Validation ─────────────────────────────────────────────

export type RepairUnderstandingValidation =
  | { success: true; payload: RepairUnderstandingPayload }
  | { success: false; error: string };

/**
 * Validate an untrusted `POST /api/repair/understanding` body.
 *
 * Schema validation is the whole of it — there is no cross-field invariant to
 * enforce, because the client supplies nothing that could contradict anything.
 *
 * @param body - Untrusted request body
 */
export function validateRepairUnderstanding(
  body: unknown,
): RepairUnderstandingValidation {
  const parsed = repairUnderstandingPayloadSchema.safeParse(body);

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return {
      success: false,
      error: `Invalid post-repair understanding payload — ${detail}`,
    };
  }

  return { success: true, payload: parsed.data };
}

// ─── Builder ────────────────────────────────────────────────

/**
 * Build the append-only `revision_events` row for a post-repair self-assessment.
 *
 * Pure and deterministic apart from the injected timestamp. Records the
 * student's answer verbatim and computes no judgment about it. Never invokes
 * SM-2, mastery, or the legacy diagnostic engine.
 *
 * @param payload - A validated understanding payload
 * @param context - Facts derived from the stored repair_verification event
 * @param now - Report timestamp (injectable for tests)
 */
export function buildRepairUnderstandingEvent(
  payload: RepairUnderstandingPayload,
  context: DerivedRepairContext,
  now: Date = new Date(),
): RepairUnderstandingEvent {
  return {
    eventType: REPAIR_UNDERSTANDING_EVENT_TYPE,
    // SM-2 isolation: no quality signal, no MCQ correctness column.
    qualityRating: null,
    mcqCorrect: null,
    mcqQuestionIndex: null,
    eventMetadata: {
      requestId: payload.requestId,
      conceptId: context.conceptId,
      failureReason: context.failureReason,
      repairIntent: context.repairIntent,
      postRepairUnderstanding: payload.postRepairUnderstanding,
      reportedAt: now.toISOString(),
    },
  };
}
