/**
 * MCQ answer-key audit.
 *
 * Generated MCQs are solved again by independent model calls that never see
 * the stated key. A question survives only if EVERY auditor that ran agrees
 * with the key and finds no flaw.
 *
 * Two auditors from different model families:
 *   - primary:   the configured main model (via the AI client)
 *   - secondary: a different family on Groq (default qwen/qwen3.8-27b)
 * One model auditing its own output shares its misconceptions; a second
 * family catches some of those (verified: it caught a wrong EIA-threshold key
 * the primary passed). Neither catches everything — students can still hit a
 * wrong key, so a report mechanism remains necessary.
 *
 * Fail-open per auditor: if an auditor's call fails, its verdicts are simply
 * absent. `audited` is true only if the primary ran (or, in secondary-only
 * mode, the secondary).
 */

import { z } from "zod";
import { executeWithRetry } from "@/lib/ai/client";
import { validateAIResponse } from "@/lib/ai/utils/response-validator";

export interface AuditableMcq {
  question: string;
  options: { a: string; b: string; c: string; d: string };
  correctAnswer: string;
}

export interface AuditVerdict {
  index: number;
  answer: "a" | "b" | "c" | "d" | null;
  flawed: boolean;
  reason: string;
  auditor?: string;
}

export interface AuditResult<T> {
  kept: T[];
  dropped: Array<{ mcq: T; verdict: AuditVerdict }>;
  audited: boolean;
  auditors: string[];
}

const auditSchema = z.object({
  results: z.array(
    z.object({
      index: z.number().int().min(0),
      answer: z.enum(["a", "b", "c", "d"]).nullable().catch(null),
      flawed: z.boolean().catch(false),
      reason: z.string().catch(""),
    }),
  ),
});

export const AUDIT_SYSTEM_PROMPT = `You are a UPSC Prelims question auditor.
Solve each question independently from established, CURRENT facts. You are NOT given the intended answers.
For each question return, in this order:
- "reason": check each statement or option briefly (true/false and why), in at most three short sentences. Work it out here first.
- "flawed": true if any statement or option rests on a factual error or outdated figure, if the question is ambiguous, or if the options cannot represent the true situation (e.g. both statements are false but no option says so).
- "answer": the single correct option letter that follows from your reason, or null if no option is correct or more than one is. It must agree with your reason.
For Statement-I/Statement-II questions, Statement-II "explains" Statement-I only if it is the actual reason for it — not merely a related fact or a special case.
Respond ONLY with valid JSON: {"results":[{"index":0,"reason":"1 true (...); 2 true (...); 3 false (...).","flawed":false,"answer":"b"}]}`;

const DEFAULT_SECONDARY_MODEL = "qwen/qwen3.8-27b";
const secondaryModel = () => process.env.GROQ_SECONDARY_AUDIT_MODEL || DEFAULT_SECONDARY_MODEL;

/** Build the audit prompt — the stated keys are deliberately omitted. */
export function buildAuditPrompt(mcqs: AuditableMcq[]): string {
  const body = mcqs
    .map((m, i) => `QUESTION ${i}\n${m.question}\n(a) ${m.options.a}\n(b) ${m.options.b}\n(c) ${m.options.c}\n(d) ${m.options.d}`)
    .join("\n\n");
  return `${body}\n\nSolve all ${mcqs.length} questions.`;
}

/** Pure: which MCQs survive one auditor's verdicts. Missing verdict → keep. */
export function applyAudit<T extends AuditableMcq>(mcqs: T[], verdicts: AuditVerdict[]): { kept: T[]; dropped: Array<{ mcq: T; verdict: AuditVerdict }> } {
  return combineAudits(mcqs, [verdicts]);
}

/** Pure: combine several auditors — a question survives only if all agree. */
export function combineAudits<T extends AuditableMcq>(mcqs: T[], verdictSets: AuditVerdict[][]): { kept: T[]; dropped: Array<{ mcq: T; verdict: AuditVerdict }> } {
  const dropped: Array<{ mcq: T; verdict: AuditVerdict }> = [];
  const droppedIdx = new Set<number>();
  for (const verdicts of verdictSets) {
    const byIndex = new Map(verdicts.map((v) => [v.index, v]));
    mcqs.forEach((m, i) => {
      if (droppedIdx.has(i)) return;
      const v = byIndex.get(i);
      if (v && (v.flawed || v.answer === null || v.answer !== m.correctAnswer)) {
        droppedIdx.add(i);
        dropped.push({ mcq: m, verdict: v });
      }
    });
  }
  return { kept: mcqs.filter((_, i) => !droppedIdx.has(i)), dropped };
}

async function primaryVerdicts(mcqs: AuditableMcq[]): Promise<AuditVerdict[] | null> {
  try {
    const res = await executeWithRetry(
      { prompt: buildAuditPrompt(mcqs), systemPrompt: AUDIT_SYSTEM_PROMPT, temperature: 0, maxTokens: 6_000, format: "json" },
      3, // enough attempts to wait out a 429 (each wait follows the provider's hint)
    );
    const v = validateAIResponse(res.content, auditSchema);
    if (!v.success || !v.data) {
      console.warn("[MCQ AUDIT] Unparseable primary audit:", v.errors.slice(0, 2));
      return null;
    }
    return v.data.results.map((r) => ({ ...r, auditor: "primary" }));
  } catch (err) {
    console.warn("[MCQ AUDIT] Primary audit failed:", err instanceof Error ? err.message.slice(0, 200) : err);
    return null;
  }
}

/** Second model family via Groq directly (the AI client is pinned to the main model). */
export async function secondaryVerdicts(mcqs: AuditableMcq[]): Promise<AuditVerdict[] | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  const baseUrl = process.env.GROQ_BASE_URL || "https://api.groq.com";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: secondaryModel(),
          temperature: 0,
          max_completion_tokens: 6_000,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: AUDIT_SYSTEM_PROMPT },
            { role: "user", content: buildAuditPrompt(mcqs) },
          ],
        }),
      });
      if (res.status === 429) {
        const msg = await res.text();
        const m = msg.match(/try again in\s+(?:(\d+)m)?\s*([\d.]+)\s*s/i);
        const wait = m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : 15;
        if (wait > 30) return null; // daily limit: give up rather than stall
        await new Promise((r) => setTimeout(r, Math.ceil(wait * 1000) + 750));
        continue;
      }
      const json = await res.json().catch(() => null);
      if (!res.ok) return null;
      const content = String(json?.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "");
      const v = validateAIResponse(content, auditSchema);
      if (!v.success || !v.data) return null;
      return v.data.results.map((r) => ({ ...r, auditor: secondaryModel() }));
    } catch {
      return null;
    }
  }
  return null;
}

export async function auditMcqKeys<T extends AuditableMcq>(
  mcqs: T[],
  options: { primary?: boolean; secondary?: boolean } = {},
): Promise<AuditResult<T>> {
  const usePrimary = options.primary ?? true;
  const useSecondary = options.secondary ?? true;
  if (mcqs.length === 0) return { kept: mcqs, dropped: [], audited: false, auditors: [] };

  const [p, s] = await Promise.all([
    usePrimary ? primaryVerdicts(mcqs) : Promise.resolve(null),
    useSecondary ? secondaryVerdicts(mcqs) : Promise.resolve(null),
  ]);

  const sets = [p, s].filter((x): x is AuditVerdict[] => x !== null);
  if (sets.length === 0) {
    console.warn("[MCQ AUDIT] No auditor ran; keeping questions unaudited");
    return { kept: mcqs, dropped: [], audited: false, auditors: [] };
  }

  const result = combineAudits(mcqs, sets);
  for (const d of result.dropped) {
    console.warn("[MCQ AUDIT] Dropped:", { auditor: d.verdict.auditor, stated: d.mcq.correctAnswer, answer: d.verdict.answer, flawed: d.verdict.flawed, reason: d.verdict.reason });
  }
  return {
    ...result,
    audited: usePrimary ? p !== null : s !== null,
    auditors: [p ? "primary" : null, s ? secondaryModel() : null].filter((x): x is string => !!x),
  };
}
