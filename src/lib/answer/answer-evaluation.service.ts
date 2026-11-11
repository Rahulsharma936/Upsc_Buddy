/**
 * Written-answer evaluation service.
 *
 * Efficient split:
 *   - Photos → transcription by a vision model (one Groq call for all pages).
 *   - Marking → the main text model through the existing AI client.
 * Typed answers skip transcription entirely. The vision model only reads; the
 * stronger text model does the judging.
 *
 * Writes nothing. The caller records the outcome through existing routes.
 */

import { executeWithRetry } from "@/lib/ai/client";
import { validateAIResponse } from "@/lib/ai/utils/response-validator";
import {
  TRANSCRIPTION_PROMPT,
  EVALUATION_SYSTEM_PROMPT,
  buildEvaluationPrompt,
  combineAnswer,
  evaluationSchema,
  normalizeScore,
  referenceToText,
  sanitizeTranscription,
  scoreToQuality,
  MIN_ANSWER_LENGTH,
  type EvaluateRequest,
  type EvaluateResponse,
} from "./answer-evaluation";

const DEFAULT_VISION_MODEL = "qwen/qwen3.8-27b";
const VISION_TIMEOUT_MS = 60_000;

export class AnswerEvaluationError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message);
  }
}

export const answerEvaluationService = {
  /** Transcribe handwritten answer photos with the configured vision model. */
  async transcribe(images: string[]): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new AnswerEvaluationError("Photo answers need a vision model and none is configured. Type your answer instead.", 503);
    }
    const baseUrl = process.env.GROQ_BASE_URL || "https://api.groq.com";
    const model = process.env.GROQ_VISION_MODEL || DEFAULT_VISION_MODEL;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
    try {
      const res = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          temperature: 0,
          max_completion_tokens: 2_500,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: TRANSCRIPTION_PROMPT },
                ...images.map((url) => ({ type: "image_url", image_url: { url } })),
              ],
            },
          ],
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = json?.error?.message ?? `HTTP ${res.status}`;
        throw new AnswerEvaluationError(`Could not read the photo: ${msg}`, 502);
      }
      return sanitizeTranscription(String(json?.choices?.[0]?.message?.content ?? ""));
    } catch (err) {
      if (err instanceof AnswerEvaluationError) throw err;
      const aborted = err instanceof Error && err.name === "AbortError";
      throw new AnswerEvaluationError(aborted ? "Reading the photo timed out. Try a clearer or smaller photo." : "Could not read the photo.", 502);
    } finally {
      clearTimeout(timer);
    }
  },

  async evaluate(
    req: EvaluateRequest,
    note: { coreIdea?: string | null; examTriggers?: string[] | null; staticCurrentLink?: string[] | null } | null,
  ): Promise<EvaluateResponse> {
    const transcription = req.images && req.images.length > 0 ? await this.transcribe(req.images) : null;
    const { text, source } = combineAnswer(req.typedAnswer, transcription);

    if (text.replace(/\[illegible\]/gi, "").trim().length < MIN_ANSWER_LENGTH) {
      throw new AnswerEvaluationError(
        transcription !== null
          ? "No readable answer found in the photo. Retake it in good light, or type your answer."
          : "Write an answer first.",
      );
    }

    const prompt = buildEvaluationPrompt({
      mode: req.mode,
      question: req.question,
      answer: text,
      reference: referenceToText(req.reference),
      note,
      marks: req.marks,
    });

    const ai = await executeWithRetry({
      prompt,
      systemPrompt: EVALUATION_SYSTEM_PROMPT,
      temperature: 0.1,
      maxTokens: 1_200,
      format: "json",
    });

    const validation = validateAIResponse(ai.content, evaluationSchema);
    if (!validation.success || !validation.data) {
      throw new AnswerEvaluationError(`Evaluation failed: ${validation.errors.join("; ")}`, 502);
    }

    const evaluation = { ...validation.data, score: normalizeScore(validation.data.score) };
    return {
      answerText: text,
      transcription,
      source,
      evaluation,
      quality: scoreToQuality(evaluation.score),
    };
  },
};
