/**
 * Written Answer Evaluation API.
 *
 * POST /api/answer/evaluate
 *   Body: { conceptId, mode: "recall" | "mains", question, typedAnswer?,
 *           images?: string[] (data URLs, ≤ 3), reference?, marks? }
 *
 * Reads a typed answer and/or photos of an answer written on paper, then marks
 * it against the supplied reference and the student's own note.
 *
 * Read-only: nothing is persisted here. Callers record the outcome through
 * POST /api/revision (existing `review` event) when it should count.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/utils/auth-helper";
import { conceptRepository } from "@/lib/repositories/concept.repository";
import { noteRepository } from "@/lib/repositories/note.repository";
import { evaluateRequestSchema } from "@/lib/answer/answer-evaluation";
import { answerEvaluationService, AnswerEvaluationError } from "@/lib/answer/answer-evaluation.service";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ success: false, error: { message } }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return errorResponse("Unauthorized", 401);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Request body must be valid JSON");
    }

    const parsed = evaluateRequestSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      return errorResponse(`Invalid request — ${detail}`);
    }
    const req = parsed.data;

    if (!req.typedAnswer?.trim() && !(req.images && req.images.length > 0)) {
      return errorResponse("Write an answer or attach a photo of it.");
    }

    const concept = await conceptRepository.findById(req.conceptId);
    if (!concept || concept.userId !== user.id) return errorResponse("Concept not found", 404);

    const noteRow = await noteRepository.findLatestByConceptId(req.conceptId).catch(() => undefined);
    const note = noteRow
      ? { coreIdea: noteRow.coreIdea, examTriggers: noteRow.examTriggers, staticCurrentLink: noteRow.staticCurrentLink }
      : null;

    const result = await answerEvaluationService.evaluate(req, note);
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof AnswerEvaluationError) return errorResponse(err.message, err.status);
    const message = err instanceof Error ? err.message : "Evaluation failed";
    console.error("[ANSWER EVALUATE] Error:", message);
    return errorResponse("Evaluation failed. Please try again.", 500);
  }
}
