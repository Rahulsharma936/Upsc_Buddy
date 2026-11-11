/**
 * Interview Answer API.
 *
 * POST /api/answer/interview  (multipart/form-data)
 *   conceptId   uuid
 *   prompt      the interview question
 *   dimensions  JSON array of expected dimensions (optional)
 *   audio       the recording (webm/ogg/mp4/mpeg/wav, ≤ 10 MB)   — or —
 *   transcript  a typed answer when no microphone is available
 *
 * Returns the transcript, measured delivery metrics and a board-style
 * evaluation. Read-only; callers record the outcome via POST /api/revision.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/utils/auth-helper";
import { conceptRepository } from "@/lib/repositories/concept.repository";
import { noteRepository } from "@/lib/repositories/note.repository";
import { MAX_AUDIO_BYTES, isAllowedAudio } from "@/lib/answer/interview";
import { interviewService, InterviewError } from "@/lib/answer/interview.service";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ success: false, error: { message } }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return errorResponse("Unauthorized", 401);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return errorResponse("Expected multipart/form-data");
    }

    const conceptId = String(form.get("conceptId") ?? "");
    const prompt = String(form.get("prompt") ?? "").trim();
    const typed = String(form.get("transcript") ?? "").trim();
    const audio = form.get("audio");
    let dimensions: string[] = [];
    try {
      const raw = form.get("dimensions");
      if (raw) dimensions = (JSON.parse(String(raw)) as unknown[]).filter((d): d is string => typeof d === "string").slice(0, 8);
    } catch {
      return errorResponse("dimensions must be a JSON array of strings");
    }

    if (!UUID.test(conceptId)) return errorResponse("conceptId must be a UUID");
    if (prompt.length < 10 || prompt.length > 2_000) return errorResponse("prompt is required");

    let blob: Blob | null = null;
    let mime = "";
    if (audio && typeof audio !== "string") {
      blob = audio;
      mime = audio.type || "audio/webm";
      if (!isAllowedAudio(mime)) return errorResponse(`Unsupported audio type: ${mime}`);
      if (audio.size === 0) return errorResponse("The recording is empty.");
      if (audio.size > MAX_AUDIO_BYTES) return errorResponse("Recording is too large (limit 10 MB). Keep answers under 3 minutes.");
    } else if (!typed) {
      return errorResponse("Record an answer or type one.");
    }

    const concept = await conceptRepository.findById(conceptId);
    if (!concept || concept.userId !== user.id) return errorResponse("Concept not found", 404);
    const note = await noteRepository.findLatestByConceptId(conceptId).catch(() => undefined);

    const result = await interviewService.evaluate({
      audio: blob,
      mime,
      typedTranscript: blob ? undefined : typed,
      prompt,
      dimensions,
      conceptName: concept.displayName,
      keywords: concept.keywords ?? [],
      note: note ? { coreIdea: note.coreIdea, staticCurrentLink: note.staticCurrentLink } : null,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof InterviewError) return errorResponse(err.message, err.status);
    console.error("[ANSWER INTERVIEW] Error:", err instanceof Error ? err.message : err);
    return errorResponse("Evaluation failed. Please try again.", 500);
  }
}
