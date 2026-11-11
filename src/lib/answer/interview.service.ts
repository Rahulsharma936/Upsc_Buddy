/**
 * Interview answer service: audio → Whisper transcript → delivery metrics →
 * board-style evaluation. Writes nothing; callers record via /api/revision.
 */

import { executeWithRetry } from "@/lib/ai/client";
import { validateAIResponse } from "@/lib/ai/utils/response-validator";
import { scoreToQuality } from "./answer-evaluation";
import {
  INTERVIEW_SYSTEM_PROMPT,
  baseMime,
  buildInterviewPrompt,
  computeDelivery,
  interviewEvaluationSchema,
  normalizeInterviewScore,
  whisperPrompt,
  type InterviewResponse,
  type TranscriptSegment,
} from "./interview";

const DEFAULT_STT_MODEL = "whisper-large-v3-turbo";
const STT_TIMEOUT_MS = 90_000;

export class InterviewError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message);
  }
}

const EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/aac": "aac",
};

export const interviewService = {
  async transcribe(audio: Blob, mime: string, context: { conceptName: string; keywords: string[] }): Promise<{ text: string; duration: number; segments: TranscriptSegment[] }> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new InterviewError("Voice answers need a speech-to-text model and none is configured.", 503);
    const baseUrl = process.env.GROQ_BASE_URL || "https://api.groq.com";
    const model = process.env.GROQ_STT_MODEL || DEFAULT_STT_MODEL;

    const form = new FormData();
    form.append("file", audio, `answer.${EXT[baseMime(mime)] ?? "webm"}`);
    form.append("model", model);
    form.append("response_format", "verbose_json");
    form.append("language", "en");
    form.append("temperature", "0");
    form.append("prompt", whisperPrompt(context.conceptName, context.keywords));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STT_TIMEOUT_MS);
    try {
      const res = await fetch(`${baseUrl}/openai/v1/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new InterviewError(`Could not transcribe the recording: ${json?.error?.message ?? `HTTP ${res.status}`}`, 502);
      const segments: TranscriptSegment[] = Array.isArray(json?.segments)
        ? json.segments.map((s: { start: number; end: number; text: string }) => ({ start: Number(s.start), end: Number(s.end), text: String(s.text ?? "") }))
        : [];
      const duration = Number(json?.duration) || (segments.length ? segments[segments.length - 1].end : 0);
      return { text: String(json?.text ?? "").trim(), duration, segments };
    } catch (err) {
      if (err instanceof InterviewError) throw err;
      const aborted = err instanceof Error && err.name === "AbortError";
      throw new InterviewError(aborted ? "Transcription timed out. Try a shorter answer." : "Could not transcribe the recording.", 502);
    } finally {
      clearTimeout(timer);
    }
  },

  async evaluate(params: {
    audio?: Blob | null;
    mime?: string;
    typedTranscript?: string;
    prompt: string;
    dimensions: string[];
    conceptName: string;
    keywords: string[];
    note: { coreIdea?: string | null; staticCurrentLink?: string[] | null } | null;
  }): Promise<InterviewResponse> {
    let transcript = (params.typedTranscript ?? "").trim();
    let duration = 0;
    let segments: TranscriptSegment[] = [];

    if (params.audio) {
      const t = await this.transcribe(params.audio, params.mime ?? "audio/webm", { conceptName: params.conceptName, keywords: params.keywords });
      transcript = t.text;
      duration = t.duration;
      segments = t.segments;
    }

    if (transcript.split(/\s+/).filter(Boolean).length < 8) {
      throw new InterviewError(params.audio ? "Too little speech was detected. Record a fuller answer in a quiet place." : "Write a fuller answer.");
    }

    // Typed fallback has no timing: assume a conversational 140 wpm for the length estimate.
    if (!params.audio) duration = (transcript.split(/\s+/).length / 140) * 60;
    const delivery = computeDelivery(transcript, duration, segments);

    const ai = await executeWithRetry({
      prompt: buildInterviewPrompt({ prompt: params.prompt, dimensions: params.dimensions, transcript, delivery, conceptName: params.conceptName, note: params.note }),
      systemPrompt: INTERVIEW_SYSTEM_PROMPT,
      temperature: 0.1,
      maxTokens: 1_800,
      format: "json",
    });
    const v = validateAIResponse(ai.content, interviewEvaluationSchema);
    if (!v.success || !v.data) throw new InterviewError(`Evaluation failed: ${v.errors.join("; ")}`, 502);

    const evaluation = { ...v.data, score: normalizeInterviewScore(v.data.score) };
    return { transcript, delivery, evaluation, quality: scoreToQuality(evaluation.score) };
  },
};
