"use client";

/**
 * RevisionSession — question-based revision.
 *
 *   Launcher → one due concept at a time:
 *     MCQ available     → answer → confidence (correct) / failure reason (wrong)
 *                         → SM-2 schedule → optional repair → next
 *     no questions yet  → generate UPSC-standard questions now (saved to the
 *                         concept's inventory) → ask the MCQ
 *     still no MCQ      → write an answer (typed or photographed) → marked
 *                         → SM-2 schedule → repair if weak → next
 *   → completion summary.
 *
 * Writes only through existing routes: POST /api/revision (mcq_attempt,
 * review, skip), POST /api/ai/questions, /api/answer/evaluate, and the repair
 * routes via RepairFlow. GET /api/revision/session marks concepts already
 * handled today so a refresh resumes instead of repeating.
 */

import { useCallback, useEffect, useState } from "react";
import type { ContentScope } from "@/lib/content-scope";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { RevisionSessionItem, RevisionSessionPayload } from "@/lib/revision-session/revision-session.service";
import { pickTransferMcq } from "@/lib/reinforcement/reinforcement.engine";
import {
  pickMains,
  scheduleLabel,
  summarizeSession,
  type SessionOutcome,
  type SessionResult,
} from "@/lib/revision-session/revision-session.engine";
import { RepairFlow } from "@/components/features/repair/RepairFlow";
import { WrittenAnswer } from "@/components/features/answer/WrittenAnswer";
import { FAILURE_REASONS, POST_OUTCOME_CONFIDENCE, REPAIR_CTA_LABEL } from "@/components/features/repair/repair-ui";
import type { EvaluateResponse } from "@/lib/answer/answer-evaluation";

// ─── Local types ────────────────────────────────────────────

type Phase =
  | "preparing"     // generating questions for a concept that has none
  | "question"      // MCQ shown, not answered
  | "post_outcome"  // answered; collecting confidence / failure reason
  | "write"         // no MCQ: written answer
  | "reason"        // weak written answer: student says what went wrong
  | "feedback";     // saved; schedule shown; repair; Next

interface ItemState {
  phase: Phase;
  selected: string | null;
  outcome: SessionOutcome | null;
  failureReason: string | null;
  intervalDays: number | null;
  saveFailed: boolean;
  repairOpen: boolean;
  repairSettled: boolean;
  score: number | null;
  prepareError: string | null;
}

const SUBJECT_COLORS: Record<string, string> = {
  Polity: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  Geography: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  History: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  Economy: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  Ethics: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  CurrentAffairs: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
};

const OUTCOME_LABEL: Record<SessionOutcome, string> = {
  correct: "Correct",
  wrong: "Incorrect",
  remembered: "Strong answer",
  partially: "Adequate answer",
  forgot: "Weak answer",
  skipped: "Skipped",
};

function freshState(item: RevisionSessionItem): ItemState {
  return {
    phase: item.mcq ? "question" : item.needsQuestions ? "preparing" : "write",
    selected: null,
    outcome: null,
    failureReason: null,
    intervalDays: null,
    saveFailed: false,
    repairOpen: false,
    repairSettled: false,
    score: null,
    prepareError: null,
  };
}

function localMidnightIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * A serious prompt when the concept has neither an MCQ nor a Mains question.
 * Subject-aware, so a geography concept is not asked for a "legal basis".
 */
function fallbackPrompt(item: RevisionSessionItem): string {
  const name = item.conceptName;
  switch (item.subject) {
    case "Polity":
      return `Explain ${name}: its constitutional or statutory basis, how it works in practice, and one recent judgment, amendment or controversy that tests it. (100 words)`;
    case "Economy":
      return `Explain ${name}: the mechanism, the institutions or policy instruments involved, and its current relevance to India's economy with one example. (100 words)`;
    case "History":
      return `Explain ${name}: its causes or context, its key features, and its significance for later developments. (100 words)`;
    case "Ethics":
      return `Explain ${name}: the principle involved, its application to public administration, and one case or example that illustrates it. (100 words)`;
    case "Geography":
      return `Explain ${name}: the underlying physical or human-geographic mechanism, where it operates, and one present-day consequence relevant to India. (100 words)`;
    default:
      return `Explain ${name}: what it is, the mechanism or framework behind it, and one current development it bears on. (100 words)`;
  }
}

// ─── Component ──────────────────────────────────────────────

export function RevisionSession({ onSessionEnd, scope = "all" }: { onSessionEnd?: () => void; scope?: ContentScope } = {}) {
  const [payload, setPayload] = useState<RevisionSessionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [queue, setQueue] = useState<RevisionSessionItem[]>([]);
  const [index, setIndex] = useState(0);
  const [state, setState] = useState<ItemState | null>(null);
  const [results, setResults] = useState<SessionResult[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/revision/session?since=${encodeURIComponent(localMidnightIso())}${scope === "all" ? "" : `&scope=${scope}`}`)
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) throw new Error(json?.error?.message || "Could not load your session");
        setPayload(json.data as RevisionSessionPayload);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load your session"))
      .finally(() => setLoading(false));
  }, [scope]);

  useEffect(() => {
    const id = window.setTimeout(load, 0);
    return () => window.clearTimeout(id);
  }, [load]);

  const current = started ? queue[index] : undefined;
  const finished = started && index >= queue.length;

  // Concept with no questions: generate them now (persisted to its inventory).
  const phase = state?.phase;
  const currentId = current?.conceptId;
  useEffect(() => {
    if (phase !== "preparing" || !currentId) return;
    let stale = false;
    fetch("/api/ai/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conceptId: currentId }),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) throw new Error(json?.error?.message || "Question generation failed");
        const q = json.data?.questions ?? {};
        const mcq = pickTransferMcq(Array.isArray(q.prelimsMcqs) ? q.prelimsMcqs : [], {
          attemptedQuestionIds: new Set(),
          attemptedQuestionIndexes: new Set(),
        });
        const mains = pickMains(q.mainsQuestions);
        if (stale) return;
        setQueue((prev) => prev.map((it) => (it.conceptId === currentId ? { ...it, mcq, mains: mcq ? null : mains, needsQuestions: false } : it)));
        setState((s) => (s && s.phase === "preparing" ? { ...s, phase: mcq ? "question" : "write" } : s));
      })
      .catch((err) => {
        if (stale) return;
        setState((s) => (s && s.phase === "preparing" ? { ...s, phase: "write", prepareError: err instanceof Error ? err.message : "Question generation failed" } : s));
      });
    return () => {
      stale = true;
    };
  }, [phase, currentId]);

  const start = () => {
    if (!payload) return;
    const remaining = payload.items.filter((i) => !i.completedToday);
    setQueue(remaining);
    setIndex(0);
    setResults([]);
    setState(remaining[0] ? freshState(remaining[0]) : null);
    setStarted(true);
  };

  const recordResult = (item: RevisionSessionItem, outcome: SessionOutcome, intervalDays: number | null, extra: Partial<SessionResult> = {}) => {
    setResults((prev) => {
      const existing = prev.find((r) => r.conceptId === item.conceptId);
      const without = prev.filter((r) => r.conceptId !== item.conceptId);
      return [...without, { conceptId: item.conceptId, conceptName: item.conceptName, outcome, intervalDays, repaired: existing?.repaired ?? false, ...extra }];
    });
  };

  const postRevision = async (body: Record<string, unknown>): Promise<{ intervalDays: number | null; ok: boolean }> => {
    try {
      const res = await fetch("/api/revision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) return { intervalDays: null, ok: false };
      const days = json.data?.intervalDays;
      return { intervalDays: typeof days === "number" ? days : null, ok: true };
    } catch {
      return { intervalDays: null, ok: false };
    }
  };

  // ── MCQ ──

  const handleSelect = (opt: string) => {
    if (!current || !state || state.phase !== "question") return;
    setState({ ...state, selected: opt, phase: "post_outcome" });
  };

  const handlePostOutcome = async (value: number | string) => {
    if (!current?.mcq || !state || state.phase !== "post_outcome" || saving) return;
    const isCorrect = state.selected === current.mcq.correctAnswer;
    const outcome: SessionOutcome = isCorrect ? "correct" : "wrong";
    const failureReason = !isCorrect && typeof value === "string" ? value : null;

    setSaving(true);
    const { intervalDays, ok } = await postRevision({
      conceptId: current.conceptId,
      action: "mcq_attempt",
      quality: isCorrect ? 4 : 1,
      mcqCorrect: isCorrect,
      mcqQuestionIndex: current.mcq.questionIndex,
      ...(current.mcq.questionId ? { mcqQuestionId: current.mcq.questionId } : {}),
      selectedAnswer: state.selected,
      correctAnswer: current.mcq.correctAnswer,
      ...(isCorrect ? { confidence: value } : { failureReason: value }),
    });
    setSaving(false);

    setState({ ...state, phase: "feedback", outcome, failureReason, intervalDays, saveFailed: !ok });
    recordResult(current, outcome, intervalDays);
  };

  // ── Written answer ──

  const handleWritten = async (result: EvaluateResponse) => {
    if (!current || !state || state.phase !== "write") return;
    const score = result.evaluation.score;
    const outcome: SessionOutcome = score >= 7 ? "remembered" : score >= 5 ? "partially" : "forgot";

    setSaving(true);
    const { intervalDays, ok } = await postRevision({
      conceptId: current.conceptId,
      action: "review",
      quality: result.quality,
      writtenScore: score,
      writtenMaxScore: 10,
      answerSource: result.source,
      answerMode: current.mains ? "mains" : "recall",
      answerExcerpt: result.answerText.slice(0, 300),
    });
    setSaving(false);

    setState({ ...state, outcome, intervalDays, saveFailed: !ok, score, phase: score < 5 ? "reason" : "feedback" });
    recordResult(current, outcome, intervalDays, { score });
  };

  const handleReason = (reason: string) => {
    if (!current || !state || state.phase !== "reason") return;
    setState({ ...state, phase: "feedback", failureReason: reason });
  };

  // ── Shared ──

  const advance = () => {
    const nextIndex = index + 1;
    setIndex(nextIndex);
    setState(queue[nextIndex] ? freshState(queue[nextIndex]) : null);
    if (!queue[nextIndex]) onSessionEnd?.();
  };

  const handleSkip = async () => {
    if (!current || !state || saving) return;
    setSaving(true);
    await postRevision({ conceptId: current.conceptId, action: "skip" });
    setSaving(false);
    recordResult(current, "skipped", null);
    advance();
  };

  const openRepair = () => {
    if (!current || !state) return;
    setState({ ...state, repairOpen: true });
    recordResult(current, state.outcome ?? "wrong", state.intervalDays, { repaired: true, ...(state.score !== null ? { score: state.score } : {}) });
  };

  // ── Render: loading / error / launcher ──

  if (loading) {
    return (
      <Card className="border-border/60">
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Preparing today&apos;s revision…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-border/60">
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground">{error}</p>
          <button onClick={load} className="mt-2 text-sm font-medium text-primary hover:underline" id="revision-session-retry">Try again</button>
        </CardContent>
      </Card>
    );
  }

  if (!payload) return null;

  if (!started) {
    const remaining = payload.remaining;
    const doneToday = payload.doneToday;
    return (
      <Card className="border-border/60">
        <CardContent className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-semibold">Revision session</p>
            {payload.totalDue === 0 ? (
              <p className="text-sm text-muted-foreground">
                {doneToday > 0
                  ? `Nothing more is due. ${doneToday} concept${doneToday === 1 ? "" : "s"} handled today.`
                  : "Nothing is due right now."}
              </p>
            ) : remaining === 0 ? (
              <p className="text-sm text-muted-foreground">Everything due today is done ({doneToday} concept{doneToday === 1 ? "" : "s"}).</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {remaining} concept{remaining === 1 ? "" : "s"} due.
                {doneToday > 0 && ` ${doneToday} already handled today; continuing from there.`}
              </p>
            )}
          </div>
          {remaining > 0 && (
            <button onClick={start} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" id="revision-session-start">
              Start session
            </button>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── Render: completion ──

  if (finished) {
    const s = summarizeSession(results);
    return (
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <p className="text-sm font-semibold">Session complete</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Answered" value={s.answered} />
            <Stat label="Held" value={s.correct + s.remembered} />
            <Stat label="Repaired" value={s.repaired} />
            <Stat label="Skipped" value={s.skipped} />
          </div>
          <p className="text-xs text-muted-foreground">
            {s.retentionRate !== null ? `Held ${Math.round(s.retentionRate * 100)}% of the ${s.answered} answered.` : "Nothing answered this time."}
            {s.skipped > 0 && ` ${s.skipped} skipped; ${s.skipped === 1 ? "it returns" : "they return"} tomorrow.`}
            {" "}All of these are already rescheduled.
          </p>
          <ul className="divide-y divide-border/60 rounded-md border border-border/60">
            {results.map((r) => (
              <li key={r.conceptId} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                <span className="truncate">{r.conceptName}</span>
                <span className="flex shrink-0 items-center gap-3 text-muted-foreground">
                  <span className={cn(r.outcome === "correct" || r.outcome === "remembered" ? "text-green-700 dark:text-green-300" : r.outcome === "skipped" ? "" : "text-red-700 dark:text-red-300")}>
                    {OUTCOME_LABEL[r.outcome]}{typeof r.score === "number" ? ` (${r.score}/10)` : ""}{r.repaired ? ", repaired" : ""}
                  </span>
                  <span>{r.outcome === "skipped" ? "Back tomorrow" : scheduleLabel(r.intervalDays)}</span>
                </span>
              </li>
            ))}
          </ul>
          <button onClick={() => { setStarted(false); load(); onSessionEnd?.(); }} className="text-sm font-medium text-primary hover:underline" id="revision-session-done">
            Back to revision
          </button>
        </CardContent>
      </Card>
    );
  }

  if (!current || !state) return null;

  // ── Render: one concept ──

  const mcq = current.mcq;
  const answered = state.selected !== null;
  const isCorrect = !!mcq && state.selected === mcq.correctAnswer;
  const canAdvance = state.phase === "feedback" && (!state.repairOpen || state.repairSettled);
  const needsRepairOffer = state.phase === "feedback" && !!state.failureReason && !state.repairOpen;
  const writtenQuestion = current.mains?.question ?? fallbackPrompt(current);

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <h3 className="truncate text-base font-semibold">{current.conceptName}</h3>
            <Badge variant="secondary" className={cn("shrink-0 text-[10px] font-medium", SUBJECT_COLORS[current.subject])}>{current.subject}</Badge>
            {current.isWeakArea && <Badge variant="outline" className="shrink-0 text-[10px]">weak area</Badge>}
          </div>
          <span className="shrink-0 text-[11px] text-muted-foreground">{index + 1} / {queue.length}</span>
        </div>
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${Math.round((index / queue.length) * 100)}%` }} />
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        {state.phase === "preparing" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" id="revision-session-preparing">
            <Loader2 className="h-4 w-4 animate-spin" /> No questions exist for this concept yet. Generating them now…
          </p>
        )}

        {/* MCQ */}
        {mcq && state.phase !== "preparing" && (
          <>
            <p className="whitespace-pre-line text-sm font-medium leading-relaxed">{mcq.question}</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {(["a", "b", "c", "d"] as const).map((opt) => {
                const selected = state.selected === opt;
                const correctOpt = mcq.correctAnswer === opt;
                return (
                  <button
                    key={opt}
                    onClick={() => handleSelect(opt)}
                    disabled={answered}
                    className={cn(
                      "flex items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      answered && correctOpt && "border-green-600/50 bg-green-50 dark:bg-green-500/10",
                      answered && selected && !correctOpt && "border-red-600/50 bg-red-50 dark:bg-red-500/10",
                      !answered && "hover:bg-muted/50 cursor-pointer",
                      answered && "cursor-default",
                    )}
                    id={`revision-session-opt-${opt}`}
                  >
                    <span className="w-5 shrink-0 text-xs font-semibold text-muted-foreground">({opt})</span>
                    <span>{mcq.options[opt]}</span>
                  </button>
                );
              })}
            </div>

            {answered && mcq.explanation && (
              <div className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">Explanation: </span>{mcq.explanation}
              </div>
            )}

            {state.phase === "post_outcome" && (
              <Choices
                title={isCorrect ? "Correct. How confident were you?" : `Incorrect. Answer: (${mcq.correctAnswer}). What went wrong?`}
                options={isCorrect
                  ? POST_OUTCOME_CONFIDENCE.map((c) => ({ key: String(c.value), label: c.label, onPick: () => handlePostOutcome(c.value) }))
                  : FAILURE_REASONS.map((r) => ({ key: r.value, label: r.label, onPick: () => handlePostOutcome(r.value) }))}
                disabled={saving}
              />
            )}
          </>
        )}

        {/* Written answer (no MCQ available) */}
        {!mcq && state.phase !== "preparing" && (
          <>
            {state.prepareError && (
              <p className="text-[11px] text-muted-foreground">Could not generate questions ({state.prepareError}). Answer in writing instead.</p>
            )}
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium leading-relaxed">{writtenQuestion}</p>
              {current.mains && <Badge variant="outline" className="shrink-0 text-[10px]">{current.mains.estimatedMarks} marks</Badge>}
            </div>
            <WrittenAnswer
              key={current.conceptId}
              conceptId={current.conceptId}
              mode={current.mains ? "mains" : "recall"}
              question={writtenQuestion}
              reference={current.mains?.guidancePoints}
              marks={current.mains?.estimatedMarks}
              onEvaluated={handleWritten}
              idPrefix="revision-session-written"
            />
            {state.phase === "reason" && (
              <Choices
                title="The answer was weak. What went wrong?"
                options={FAILURE_REASONS.map((r) => ({ key: r.value, label: r.label, onPick: () => handleReason(r.value) }))}
              />
            )}
          </>
        )}

        {saving && (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground" id="revision-session-saving">
            <Loader2 className="h-3 w-3 animate-spin" /> Saving…
          </p>
        )}

        {/* Feedback: schedule + repair + next */}
        {state.phase === "feedback" && (
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">
              {state.saveFailed ? "Could not save this attempt. Continuing anyway." : scheduleLabel(state.intervalDays)}
            </p>

            {needsRepairOffer && (
              <button onClick={openRepair} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/60 transition-colors" id="revision-session-repair">
                {REPAIR_CTA_LABEL[state.failureReason!]}
              </button>
            )}

            {state.repairOpen && state.failureReason && (
              <RepairFlow
                conceptId={current.conceptId}
                failureReason={state.failureReason}
                questionContext={mcq ? {
                  questionIndex: mcq.questionIndex,
                  selectedAnswer: state.selected ?? undefined,
                  correctAnswer: mcq.correctAnswer,
                  questionText: mcq.question,
                  ...(mcq.questionId ? { questionId: mcq.questionId } : {}),
                } : null}
                onSettled={() => setState((s) => (s ? { ...s, repairSettled: true } : s))}
              />
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <button onClick={handleSkip} disabled={saving || state.phase === "feedback" || state.phase === "preparing"} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40" id="revision-session-skip">
            Skip for now
          </button>
          {state.phase === "feedback" && (
            <button
              onClick={advance}
              disabled={!canAdvance}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
              id="revision-session-next"
            >
              {needsRepairOffer ? "Skip repair, next" : index + 1 >= queue.length ? "Finish" : "Next"}
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Small pieces ───────────────────────────────────────────

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border/60 px-3 py-2">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}

function Choices({ title, options, disabled }: { title: string; options: { key: string; label: string; onPick: () => void }[]; disabled?: boolean }) {
  return (
    <div className="rounded-md border border-border px-3 py-2.5">
      <p className="mb-2 text-xs font-semibold">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.key}
            onClick={o.onPick}
            disabled={disabled}
            className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted/60 transition-colors disabled:opacity-50"
            id={`revision-session-choice-${o.key}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
