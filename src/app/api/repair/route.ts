/**
 * Repair API — R3.2a
 *
 * POST /api/repair
 *   Body: { conceptId, failureReason, questionContext? }
 *   Orchestrates: R3.1 (RepairRequest) → R3.2 (Executor) → Repair
 *
 * Handles ALL failure reasons — every one has an executor:
 *   concept_not_understood → concept_teaching        (R3.2a)
 *   could_not_recall       → active_recall           (R3.5)
 *   misunderstood_question → question_interpretation (R3.6)
 *   guessed                → uncertainty_resolution  (R3.7)
 *   overconfident          → calibration             (R3.8)
 *   careless_mistake       → error_awareness         (R3.9)
 *   not_sure               → clarification           (R3.10)
 *
 * Every executor is grounded in the student's existing Knowledge note and held
 * to the shared UPSC verification standard (see note-grounding.ts). If the
 * verification question turns out to be a giveaway — its answer is stated in
 * the repair text — the executor is run once more with that answer banned.
 *
 * Does NOT modify SM-2, mastery, or any existing learning system.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { conceptRepository } from "@/lib/repositories/concept.repository";
import { noteRepository } from "@/lib/repositories/note.repository";
import {
  buildRepairRequest,
  ALL_FAILURE_REASONS,
} from "@/lib/repair/repair-request.builder";
import type { RepairQuestionContext, RepairIntent } from "@/lib/repair/repair-request.builder";
import { executeConceptTeaching } from "@/lib/repair/concept-teaching.executor";
import { executeActiveRecall } from "@/lib/repair/active-recall.executor";
import { executeQuestionInterpretation } from "@/lib/repair/question-interpretation.executor";
import { executeUncertaintyResolution } from "@/lib/repair/uncertainty-resolution.executor";
import { executeCalibration } from "@/lib/repair/calibration.executor";
import { executeErrorAwareness } from "@/lib/repair/error-awareness.executor";
import { executeClarification } from "@/lib/repair/clarification.executor";
import { collectShownText } from "@/lib/repair/verification-leak";
import type { RepairNoteGrounding } from "@/lib/repair/note-grounding";
import { checkProblem, chooseCheckQuestion, type CheckCandidate, type CheckContext, type CheckMcq } from "@/lib/repair/check-question";
import { checkQuestionService } from "@/lib/repair/check-question.service";
import { auditMcqKeys } from "@/lib/ai/services/mcq-audit";
import type { FailureReason } from "@/lib/evidence/evidence.types";

function errorResponse(message: string, status = 400) {
  return NextResponse.json(
    { success: false, error: { message } },
    { status },
  );
}

interface ExecutorInput {
  request: ReturnType<typeof buildRepairRequest>;
  conceptName: string;
  conceptSubject: string;
  conceptKeywords: string[];
  conceptNote: RepairNoteGrounding | null;
}

// All executors share this input shape; each returns its own content fields.
type AnyExecutor = (input: ExecutorInput) => Promise<Record<string, unknown>>;

const EXECUTORS: Record<RepairIntent, AnyExecutor> = {
  concept_teaching: executeConceptTeaching as unknown as AnyExecutor,
  active_recall: executeActiveRecall as unknown as AnyExecutor,
  question_interpretation: executeQuestionInterpretation as unknown as AnyExecutor,
  uncertainty_resolution: executeUncertaintyResolution as unknown as AnyExecutor,
  calibration: executeCalibration as unknown as AnyExecutor,
  error_awareness: executeErrorAwareness as unknown as AnyExecutor,
  clarification: executeClarification as unknown as AnyExecutor,
};

/**
 * Intents whose check question tests CONTENT, so an audited bank question on
 * the concept or a related one is the better check. Process-error intents
 * (question_interpretation, error_awareness) need a purpose-built trap, so
 * they keep the generated question.
 */
const BANK_FIRST_INTENTS = new Set<RepairIntent>([
  "concept_teaching",
  "active_recall",
  "uncertainty_resolution",
  "calibration",
]);

/** Content fields the client renders, per intent. Everything else is internal. */
const CONTENT_KEYS = ["explanation", "retrieval", "reveal", "breakdown"] as const;

function toClientRepair(repair: Record<string, unknown>) {
  const out: Record<string, unknown> = {
    requestId: repair.requestId,
    conceptId: repair.conceptId,
    failureReason: repair.failureReason,
    repairIntent: repair.repairIntent,
    verification: repair.verification ?? null,
    status: repair.status,
  };
  for (const k of CONTENT_KEYS) if (repair[k] !== undefined) out[k] = repair[k];
  return out;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return errorResponse("Unauthorized", 401);

    const body = await request.json();
    const { conceptId, failureReason, questionContext } = body;

    // ─── Validation ─────────────────────────────────────

    if (!conceptId || typeof conceptId !== "string") {
      return errorResponse("conceptId is required");
    }

    if (!failureReason || !ALL_FAILURE_REASONS.includes(failureReason as FailureReason)) {
      return errorResponse(
        `Valid failureReason required. Got: "${failureReason}". ` +
        `Valid: ${ALL_FAILURE_REASONS.join(", ")}`
      );
    }

    // ─── R3.1: Build RepairRequest ──────────────────────

    const repairRequest = buildRepairRequest({
      failureReason: failureReason as FailureReason,
      conceptId,
      questionContext: questionContext as RepairQuestionContext | undefined,
    });

    const execute = EXECUTORS[repairRequest.repairIntent];
    if (!execute) {
      return errorResponse(`Repair intent "${repairRequest.repairIntent}" is not implemented.`, 500);
    }

    // ─── Ownership + grounding ──────────────────────────

    const concept = await conceptRepository.findById(conceptId);
    if (!concept || concept.userId !== user.id) {
      return errorResponse("Concept not found", 404);
    }

    // Retrieve before generating: ground the repair in the student's existing
    // Knowledge note so the repair never contradicts what they will revise from.
    const latestNote = await noteRepository
      .findLatestByConceptId(conceptId)
      .catch(() => undefined);
    const conceptNote: RepairNoteGrounding | null = latestNote
      ? {
          coreIdea: latestNote.coreIdea ?? "",
          memoryHooks: latestNote.memoryHooks ?? [],
          examTriggers: latestNote.examTriggers ?? [],
        }
      : null;

    // Adjacent topics (concept graph) and real PYQs go to the executor up front,
    // so even a generated check question targets a neighbouring sub-topic.
    const pre = await checkQuestionService.preExecutionContext(conceptId, user.id).catch(() => ({ adjacentTopics: [], examinedPyqs: [], graphNeighbourIds: [] as string[] }));
    const missedText = (questionContext as RepairQuestionContext | undefined)?.questionText ?? null;
    const missedId = (questionContext as RepairQuestionContext | undefined)?.questionId ?? null;

    const guidance = (extra: Partial<RepairNoteGrounding> = {}): RepairNoteGrounding => ({
      coreIdea: conceptNote?.coreIdea ?? "",
      memoryHooks: conceptNote?.memoryHooks ?? [],
      examTriggers: conceptNote?.examTriggers ?? [],
      adjacentTopics: pre.adjacentTopics,
      examinedPyqs: pre.examinedPyqs,
      avoidQuestions: missedText ? [missedText] : [],
      ...extra,
    });

    const baseInput: ExecutorInput = {
      request: repairRequest,
      conceptName: concept.displayName || concept.name,
      conceptSubject: concept.subject,
      conceptKeywords: concept.keywords ?? [],
      conceptNote: guidance(),
    };

    // ─── R3.2: Execute ───────────────────────────────────

    let repair = await execute(baseInput);

    // ─── Check question: bank first, then related, then generated ──
    if (repair.verification) {
      const ctxFor = (r: Record<string, unknown>): CheckContext => ({
        shownText: collectShownText(r),
        avoidQuestions: [
          (r.retrieval as { prompt?: string } | undefined)?.prompt ?? "",
          missedText ?? "",
        ].filter(Boolean),
        missedQuestionId: missedId,
        missedQuestionText: missedText,
      });

      let chosen: CheckCandidate | null = null;
      if (BANK_FIRST_INTENTS.has(repairRequest.repairIntent)) {
        const candidates = await checkQuestionService
          .candidates({ userId: user.id, conceptId, shownText: collectShownText(repair), graphNeighbourIds: pre.graphNeighbourIds })
          .catch(() => []);
        chosen = chooseCheckQuestion(candidates, ctxFor(repair));
      }

      if (chosen) {
        repair = { ...repair, verification: { ...chosen.mcq, source: chosen.source } };
      } else {
        // Generated: must not repeat the prompt, leak its answer, or carry a wrong key.
        const problemOf = async (r: Record<string, unknown>): Promise<string | null> => {
          const v = r.verification as CheckMcq | null;
          if (!v) return null;
          const p = checkProblem({ ...v, questionId: null }, ctxFor(r));
          if (p) return p;
          const audit = await auditMcqKeys([v]);
          return audit.audited && audit.kept.length === 0 ? `answer key failed audit (${audit.dropped[0]?.verdict.reason ?? ""})` : null;
        };

        const firstProblem = await problemOf(repair);
        if (firstProblem) {
          console.warn("[REPAIR POST] Generated check question rejected; regenerating once:", firstProblem);
          try {
            const v = repair.verification as CheckMcq;
            const retried = await execute({
              ...baseInput,
              conceptNote: guidance({
                avoidAnswers: [v.options[v.correctAnswer]].filter(Boolean),
                avoidQuestions: [v.question, missedText ?? "", (repair.retrieval as { prompt?: string } | undefined)?.prompt ?? ""].filter(Boolean),
              }),
            });
            if (!(await problemOf(retried))) repair = retried;
          } catch (err) {
            console.warn("[REPAIR POST] Regeneration failed; keeping the first repair:", err);
          }
        }
        repair = { ...repair, verification: { ...(repair.verification as object), source: { kind: "generated" } } };
      }
    }

    return NextResponse.json({
      success: true,
      data: { repair: toClientRepair(repair) },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Repair execution failed";
    console.error("[REPAIR POST] Error:", message);
    return errorResponse(message, 500);
  }
}
