/**
 * Post-Repair Understanding API — R3.3
 *
 * POST /api/repair/understanding
 *   Body: { requestId, postRepairUnderstanding }
 *
 *   Persists the student's own answer to "How confident do you feel about this
 *   concept now?" as a SEPARATE `repair_understanding` event in the existing
 *   `revision_events` table.
 *
 * The client sends only those two fields. `conceptId`, `failureReason` and
 * `repairIntent` are DERIVED from the already-persisted `repair_verification`
 * event for the same requestId — the browser is never trusted for them, and a
 * requestId with no verification of its own is a 404.
 *
 * This APPENDS. The existing `repair_verification` row is read for derivation
 * and left exactly as it is: never updated, never joined into a verdict.
 *
 * CRITICAL — this route NEVER invokes SM-2:
 *   It writes through `revisionRepository.logEvent()` (a plain append-only
 *   insert), NOT through `revisionIntelligenceService.recordReview()`.
 *   No quality rating, interval, ease factor, repetition count, next review
 *   date, or concept_mastery row is read or written here.
 *
 * It also records NO judgment: no resolved flag, no status, no effectiveness
 * score. Two independent facts now exist after a repair — what happened on the
 * verification question, and what the student says they understand. Turning
 * them into a diagnosis is R3.4's job, and R3.4 does not exist yet.
 *
 * Idempotent by `requestId`: a repair is self-assessed exactly once.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { revisionRepository } from "@/lib/repositories/revision.repository";
import {
  validateRepairUnderstanding,
  deriveRepairContext,
  buildRepairUnderstandingEvent,
  REPAIR_UNDERSTANDING_EVENT_TYPE,
} from "@/lib/repair/repair-understanding";
import { REPAIR_VERIFICATION_EVENT_TYPE } from "@/lib/repair/repair-verification";
import type { RepairUnderstandingMetadata } from "@/lib/repair/repair-understanding";

function errorResponse(message: string, status = 400) {
  return NextResponse.json(
    { success: false, error: { message } },
    { status },
  );
}

export async function POST(request: NextRequest) {
  try {
    // ─── Auth ───────────────────────────────────────────

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return errorResponse("Unauthorized", 401);

    // ─── Parse + validate (Zod, strict) ─────────────────

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Request body must be valid JSON");
    }

    const validation = validateRepairUnderstanding(body);
    if (!validation.success) {
      return errorResponse(validation.error);
    }

    const { payload } = validation;

    // ─── Locate the repair this report is about ─────────
    //
    // Scoped to the authenticated user, so another student's requestId is
    // indistinguishable from one that does not exist.

    const verification = await revisionRepository.findRepairEventByRequestId(
      user.id,
      REPAIR_VERIFICATION_EVENT_TYPE,
      payload.requestId,
    );

    if (!verification) {
      return errorResponse("Repair verification not found", 404);
    }

    // ─── Server-side derivation (never client-supplied) ─

    const derivation = deriveRepairContext(
      verification.eventMetadata,
      verification.conceptId,
    );

    if (!derivation.success) {
      return errorResponse(derivation.error);
    }

    const { context } = derivation;

    // ─── Idempotency: self-assess a repair exactly once ─

    const existing = await revisionRepository.findRepairEventByRequestId(
      user.id,
      REPAIR_UNDERSTANDING_EVENT_TYPE,
      payload.requestId,
    );

    if (existing) {
      const meta = (existing.eventMetadata ?? {}) as Partial<RepairUnderstandingMetadata>;
      return NextResponse.json({
        success: true,
        data: {
          eventId: existing.id,
          requestId: payload.requestId,
          postRepairUnderstanding: meta.postRepairUnderstanding ?? null,
          duplicate: true,
        },
      });
    }

    // ─── Build + append (no SM-2) ───────────────────────

    const event = buildRepairUnderstandingEvent(payload, context);

    const record = await revisionRepository.logEvent({
      userId: user.id,
      conceptId: context.conceptId,
      eventType: event.eventType,
      qualityRating: event.qualityRating,
      mcqCorrect: event.mcqCorrect,
      mcqQuestionIndex: event.mcqQuestionIndex,
      eventMetadata: event.eventMetadata,
    });

    return NextResponse.json({
      success: true,
      data: {
        eventId: record.id,
        requestId: event.eventMetadata.requestId,
        postRepairUnderstanding: event.eventMetadata.postRepairUnderstanding,
        duplicate: false,
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Post-repair understanding failed";
    console.error("[REPAIR UNDERSTANDING POST] Error:", message);
    return errorResponse(message, 500);
  }
}
