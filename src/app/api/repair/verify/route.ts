/**
 * Repair Verification API — R3.3
 *
 * POST /api/repair/verify
 *   Body: {
 *     requestId, conceptId, failureReason, repairIntent,
 *     verificationSelectedAnswer, verificationCorrectAnswer,
 *     questionContext?, verificationQuestion?
 *   }
 *
 *   Persists the outcome of a repair's verification MCQ as a
 *   `repair_verification` event in the existing `revision_events` table.
 *
 * CRITICAL — this route NEVER invokes SM-2:
 *   It writes through `revisionRepository.logEvent()` (a plain append-only
 *   insert), NOT through `revisionIntelligenceService.recordReview()`.
 *   No quality rating, interval, ease factor, repetition count, next review
 *   date, or concept_mastery row is read or written here.
 *
 * Idempotent by `requestId`: a repair is verified exactly once.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { conceptRepository } from "@/lib/repositories/concept.repository";
import { revisionRepository } from "@/lib/repositories/revision.repository";
import {
  validateRepairVerification,
  buildRepairVerificationEvent,
} from "@/lib/repair/repair-verification";
import type { RepairVerificationMetadata } from "@/lib/repair/repair-verification";

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

    const validation = validateRepairVerification(body);
    if (!validation.success) {
      return errorResponse(validation.error);
    }

    const { payload, repairIntent } = validation;

    // ─── Ownership ──────────────────────────────────────

    const concept = await conceptRepository.findById(payload.conceptId);
    if (!concept || concept.userId !== user.id) {
      return errorResponse("Concept not found", 404);
    }

    // ─── Idempotency: verify a repair exactly once ──────

    const existing = await revisionRepository.findRepairVerification(
      user.id,
      payload.requestId,
    );

    if (existing) {
      const meta = (existing.eventMetadata ?? {}) as Partial<RepairVerificationMetadata>;
      return NextResponse.json({
        success: true,
        data: {
          eventId: existing.id,
          requestId: payload.requestId,
          verificationCorrect: meta.verificationCorrect ?? null,
          duplicate: true,
        },
      });
    }

    // ─── Build + append (no SM-2) ───────────────────────

    const event = buildRepairVerificationEvent(payload, repairIntent);

    const record = await revisionRepository.logEvent({
      userId: user.id,
      conceptId: payload.conceptId,
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
        verificationCorrect: event.eventMetadata.verificationCorrect,
        duplicate: false,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Repair verification failed";
    console.error("[REPAIR VERIFY POST] Error:", message);
    return errorResponse(message, 500);
  }
}
