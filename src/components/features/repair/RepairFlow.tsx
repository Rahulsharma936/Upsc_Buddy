"use client";

/**
 * RepairFlow — the complete R3 repair lifecycle for ONE concept, self-contained.
 *
 *   request (/api/repair) → render by intent → verification MCQ
 *   → /api/repair/verify → post-repair understanding → /api/repair/understanding
 *   → R3.4 next action (local, pure) → ReinforcementPanel
 *   → optional one re-offer (fresh requestId, same student-reported reason)
 *
 * Recall drill (active_recall): the student WRITES the answer — typed, or on
 * paper and photographed — and it is marked before the model answer is shown.
 *
 * Mounting it starts the repair; the parent shows the CTA and decides when to
 * mount. The student's failureReason is passed verbatim and never substituted.
 * Evidence writes are fire-and-forget and never block; nothing here touches SM-2.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  decideNextAction,
  applyReofferLimit,
  MAX_ADDITIONAL_REPAIR_OFFERS,
} from "@/lib/repair/repair-next-action";
import type { RepairNextAction } from "@/lib/repair/repair-next-action";
import type { PostRepairUnderstanding } from "@/lib/evidence/evidence.types";
import { ReinforcementPanel } from "@/components/features/reinforcement/ReinforcementPanel";
import { WrittenAnswer } from "@/components/features/answer/WrittenAnswer";
import {
  POST_REPAIR_UNDERSTANDING,
  REPAIR_CTA_LABEL,
  REPAIR_MODES,
  checkSourceLabel,
  repairBlocks,
  type RepairBlock,
  type RepairData,
} from "./repair-ui";

export interface RepairQuestionContextInput {
  questionIndex?: number;
  selectedAnswer?: string;
  correctAnswer?: string;
  questionText?: string;
  questionId?: string;
}

export interface RepairFlowProps {
  conceptId: string;
  /** The student's own reported reason. Authoritative. */
  failureReason: string;
  questionContext?: RepairQuestionContextInput | null;
  /** Questions already visible around this repair; reinforcement never repeats them. */
  excludeQuestionIds?: readonly string[] | null;
  excludeQuestionIndexes?: readonly number[] | null;
  /** Fires when the loop reaches a terminal state for this repair. */
  onSettled?: (outcome: RepairNextAction | "clarified") => void;
}

function FieldBlock({ label, text, italic }: RepairBlock) {
  return (
    <div>
      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("text-xs leading-relaxed text-foreground", italic && "italic")}>{text}</p>
    </div>
  );
}

export function RepairFlow({
  conceptId,
  failureReason,
  questionContext,
  excludeQuestionIds,
  excludeQuestionIndexes,
  onSettled,
}: RepairFlowProps) {
  const [repair, setRepair] = useState<RepairData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recallRevealed, setRecallRevealed] = useState(false);
  const [verificationAnswer, setVerificationAnswer] = useState<string | null>(null);
  const [verificationSaving, setVerificationSaving] = useState(false);
  const [verificationSaveFailed, setVerificationSaveFailed] = useState(false);
  const [understandingAnswer, setUnderstandingAnswer] = useState<PostRepairUnderstanding | null>(null);
  const [understandingSaving, setUnderstandingSaving] = useState(false);
  const [understandingSaveFailed, setUnderstandingSaveFailed] = useState(false);
  const [nextAction, setNextAction] = useState<RepairNextAction | null>(null);
  const [reoffersUsed, setReoffersUsed] = useState(0);
  const [attempt, setAttempt] = useState(0);
  // React Strict Mode mounts twice in development; without this guard every
  // repair would cost two LLM calls there. One request per attempt.
  const requestedAttempt = useRef<number | null>(null);

  useEffect(() => {
    if (requestedAttempt.current === attempt) return;
    requestedAttempt.current = attempt;
    // Stale only if a newer attempt started meanwhile.
    const isCurrent = () => requestedAttempt.current === attempt;
    fetch("/api/repair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conceptId,
        failureReason,
        ...(questionContext ? { questionContext } : {}),
      }),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success || !json.data?.repair) {
          throw new Error(json?.error?.message || "Repair request failed");
        }
        if (isCurrent()) {
          setRepair(json.data.repair as RepairData);
          setLoading(false);
          if ((json.data.repair as RepairData).repairIntent === "clarification") {
            onSettled?.("clarified");
          }
        }
      })
      .catch((err) => {
        if (isCurrent()) {
          setError(err instanceof Error ? err.message : "Something went wrong");
          setLoading(false);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conceptId, failureReason, attempt]);

  const handleVerificationSelect = (opt: string) => {
    if (!repair || !repair.verification) return;
    if (verificationAnswer || verificationSaving) return;

    setVerificationAnswer(opt);
    setVerificationSaving(true);
    setVerificationSaveFailed(false);

    fetch("/api/repair/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: repair.requestId,
        conceptId: repair.conceptId,
        failureReason: repair.failureReason,
        repairIntent: repair.repairIntent,
        verificationSelectedAnswer: opt,
        verificationCorrectAnswer: repair.verification.correctAnswer,
        ...(questionContext && (questionContext.questionId || typeof questionContext.questionIndex === "number")
          ? {
              questionContext: {
                ...(questionContext.questionId ? { questionId: questionContext.questionId } : {}),
                ...(typeof questionContext.questionIndex === "number" ? { questionIndex: questionContext.questionIndex } : {}),
              },
            }
          : {}),
        verificationQuestion: repair.verification.question,
      }),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) throw new Error(json?.error?.message || "Verification save failed");
      })
      .catch((err) => {
        console.warn("[RepairFlow] verification save failed:", err);
        setVerificationSaveFailed(true);
      })
      .finally(() => setVerificationSaving(false));
  };

  const handleUnderstandingSelect = (value: PostRepairUnderstanding) => {
    if (!repair || !repair.verification) return;
    if (understandingAnswer || understandingSaving) return;

    setUnderstandingAnswer(value);
    setUnderstandingSaving(true);
    setUnderstandingSaveFailed(false);

    const action = applyReofferLimit(
      decideNextAction({
        verificationCorrect: verificationAnswer === repair.verification.correctAnswer,
        postRepairUnderstanding: value,
      }),
      reoffersUsed,
    );
    setNextAction(action);
    if (action !== "offer_another_repair") onSettled?.(action);

    fetch("/api/repair/understanding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: repair.requestId, postRepairUnderstanding: value }),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) throw new Error(json?.error?.message || "Self-assessment save failed");
      })
      .catch((err) => {
        console.warn("[RepairFlow] understanding save failed:", err);
        setUnderstandingSaveFailed(true);
      })
      .finally(() => setUnderstandingSaving(false));
  };

  const handleAnotherRepair = () => {
    if (reoffersUsed >= MAX_ADDITIONAL_REPAIR_OFFERS || loading) return;
    setReoffersUsed((n) => n + 1);
    setRepair(null);
    setError(null);
    setRecallRevealed(false);
    setVerificationAnswer(null);
    setVerificationSaveFailed(false);
    setUnderstandingAnswer(null);
    setUnderstandingSaveFailed(false);
    setNextAction(null);
    setLoading(true);
    setAttempt((n) => n + 1);
  };

  const handleRetry = () => {
    setError(null);
    setLoading(true);
    setAttempt((n) => n + 1);
  };

  if (loading) {
    return (
      <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Preparing the repair…
      </p>
    );
  }

  if (error || !repair) {
    return (
      <div className="mt-2 rounded-md border border-red-200/60 dark:border-red-500/20 bg-red-50/50 dark:bg-red-500/5 px-3 py-2.5">
        <p className="text-[11px] text-red-700 dark:text-red-300">{error ?? "Repair unavailable right now."}</p>
        <button onClick={handleRetry} className="mt-1.5 text-[11px] font-medium text-red-700 dark:text-red-300 hover:underline" id="repair-flow-retry">
          Try again
        </button>
      </div>
    );
  }

  const excludeQuestionId = questionContext?.questionId ?? null;
  const excludeQuestionIndex = typeof questionContext?.questionIndex === "number" ? questionContext.questionIndex : null;
  // The consolidation panel must not repeat a bank question already used as the check.
  const checkQuestionId = repair.verification?.questionId ?? null;
  const panelExclusions = {
    excludeQuestionId,
    excludeQuestionIndex,
    excludeQuestionIds: [...(excludeQuestionIds ?? []), ...(checkQuestionId ? [checkQuestionId] : [])],
    excludeQuestionIndexes: excludeQuestionIndexes ?? null,
  };
  const sourceLabel = repair.verification ? checkSourceLabel(repair.verification) : null;
  const verificationRevealed = verificationAnswer !== null;

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-border bg-muted/20 px-4 py-3 animate-in fade-in duration-200">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
        {REPAIR_MODES[repair.repairIntent].title}
      </p>

      {repair.repairIntent === "active_recall" ? (
        <>
          <div>
            <p className="text-sm font-medium leading-relaxed text-foreground">{repair.retrieval.prompt}</p>
            {repair.retrieval.cue && (
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                <span className="font-medium">Cue:</span> {repair.retrieval.cue}
              </p>
            )}
          </div>
          {/* Write first; the model answer appears only after the answer is marked or the student gives up. */}
          <WrittenAnswer
            conceptId={conceptId}
            mode="recall"
            question={repair.retrieval.prompt}
            reference={repair.reveal.expectedAnswer}
            onEvaluated={() => setRecallRevealed(true)}
            skipLabel={recallRevealed ? undefined : "I cannot recall it — show the model answer"}
            onSkip={() => setRecallRevealed(true)}
            idPrefix="repair-recall"
          />
          {recallRevealed && (
            <div className="space-y-3 animate-in fade-in duration-200">
              {repairBlocks(repair).map((b) => <FieldBlock key={b.label} {...b} />)}
            </div>
          )}
        </>
      ) : (
        repairBlocks(repair).map((b) => <FieldBlock key={b.label} {...b} />)
      )}

      {repair.repairIntent === "clarification" && (
        <>
          <p className="mt-2.5 text-[11px] text-muted-foreground">
            Use these pointers to identify what blocked you, then attempt a similar question.
          </p>
          <ReinforcementPanel conceptId={conceptId} failureReason={repair.failureReason} outcome="clarified" {...panelExclusions} />
        </>
      )}

      {repair.verification && (repair.repairIntent !== "active_recall" || recallRevealed) && (
        <div className="mt-2 rounded-md border border-border bg-background px-3 py-2.5">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Check question{sourceLabel && <span className="ml-1.5 font-normal normal-case tracking-normal">· {sourceLabel}</span>}
          </p>
          <p className="mb-2 whitespace-pre-line text-xs font-medium leading-relaxed">{repair.verification.question}</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {(["a", "b", "c", "d"] as const).map((opt) => {
              const isCorrectOpt = repair.verification!.correctAnswer === opt;
              const isSelected = verificationAnswer === opt;
              return (
                <button
                  key={opt}
                  onClick={() => handleVerificationSelect(opt)}
                  disabled={verificationRevealed}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors",
                    verificationRevealed && isCorrectOpt && "border-green-600/50 bg-green-50 dark:bg-green-500/10",
                    verificationRevealed && isSelected && !isCorrectOpt && "border-red-600/50 bg-red-50 dark:bg-red-500/10",
                    !verificationRevealed && "hover:bg-muted/50 cursor-pointer",
                    verificationRevealed && "cursor-default",
                  )}
                  id={`repair-flow-verify-${opt}`}
                >
                  <span className="w-4 shrink-0 text-[11px] font-semibold text-muted-foreground">({opt})</span>
                  <span>{repair.verification!.options[opt]}</span>
                </button>
              );
            })}
          </div>

          {verificationRevealed && (
            <div className="mt-2 rounded-md bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">
                {verificationAnswer === repair.verification.correctAnswer ? "Correct. " : `Incorrect. Answer: (${repair.verification.correctAnswer}). `}
              </span>
              {repair.verification.explanation}
            </div>
          )}
          {verificationSaveFailed && (
            <p className="mt-1.5 text-[10px] text-muted-foreground">Could not save this result. Your answer above still stands.</p>
          )}

          {verificationRevealed && (
            <div className="mt-2.5 rounded-md border border-border px-3 py-2.5">
              <p className="mb-2 text-xs font-semibold text-foreground">How clear is the concept now?</p>
              <div className="flex flex-wrap gap-1.5">
                {POST_REPAIR_UNDERSTANDING.map((option) => {
                  const answered = understandingAnswer !== null;
                  const isSelected = understandingAnswer === option.value;
                  return (
                    <button
                      key={option.value}
                      onClick={() => handleUnderstandingSelect(option.value)}
                      disabled={answered}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                        !answered && "border-border hover:bg-muted/60 cursor-pointer",
                        answered && isSelected && "border-foreground/40 bg-muted cursor-default",
                        answered && !isSelected && "border-border opacity-40 cursor-default",
                      )}
                      id={`repair-flow-understanding-${option.value}`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              {understandingSaveFailed && (
                <p className="mt-1.5 text-[10px] text-muted-foreground">Could not save this. Your answer above still stands.</p>
              )}
            </div>
          )}

          {nextAction === "repair_complete" && (
            <>
              <p className="mt-2.5 text-[11px] font-medium text-green-700 dark:text-green-300">Repair complete.</p>
              <ReinforcementPanel conceptId={conceptId} failureReason={repair.failureReason} outcome="repair_complete" {...panelExclusions} />
            </>
          )}

          {nextAction === "leave_for_revision" && (
            <>
              <p className="mt-2.5 text-[11px] text-muted-foreground">
                This concept returns in your revision schedule. Consolidate it now:
              </p>
              <ReinforcementPanel conceptId={conceptId} failureReason={repair.failureReason} outcome="leave_for_revision" {...panelExclusions} />
            </>
          )}

          {nextAction === "offer_another_repair" && (
            <div className="mt-2.5">
              <p className="mb-1.5 text-[11px] text-muted-foreground">One more attempt from a different angle.</p>
              <button onClick={handleAnotherRepair} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/60 transition-colors" id="repair-flow-retry-repair">
                {REPAIR_CTA_LABEL[failureReason] ?? "Repair again"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
