"use client";

/**
 * PracticeCard — questions for a single concept.
 *
 *   Prelims MCQ: answer → confidence (correct) or the student's own failure
 *   reason (wrong) → saved as mcq_attempt (SM-2: correct→4, wrong→1) →
 *   optional repair through the shared RepairFlow.
 *
 *   Mains: write the answer (typed, or on paper and photographed) → marked
 *   against the examiner marking points → recorded as a `review` event with
 *   the mark mapped onto SM-2 quality. Marking points stay hidden until the
 *   student has written, so the structure is not handed to them.
 */

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { RepairFlow } from "@/components/features/repair/RepairFlow";
import { WrittenAnswer } from "@/components/features/answer/WrittenAnswer";
import { FAILURE_REASONS, POST_OUTCOME_CONFIDENCE, REPAIR_CTA_LABEL } from "@/components/features/repair/repair-ui";
import type { EvaluateResponse } from "@/lib/answer/answer-evaluation";
import { VoiceAnswer } from "@/components/features/answer/VoiceAnswer";
import type { InterviewResponse } from "@/lib/answer/interview";

interface PracticeCardProps {
  data: {
    conceptId: string;
    conceptName: string;
    subject: string;
    prelimsMcqs: {
      questionId?: string; // R1.2: stable identity — absent on legacy MCQs
      question: string;
      options: { a: string; b: string; c: string; d: string };
      correctAnswer: string;
      explanation: string;
      difficulty: string;
    }[];
    mainsQuestions: {
      question: string;
      guidancePoints: string[];
      estimatedMarks: number;
      paperRelevance: string;
    }[];
    interviewPrompts: {
      prompt: string;
      expectedDimensions: string[];
      difficulty: string;
    }[];
  };
  mode: string;
  onGenerate?: (conceptId: string) => void;
  isGenerating?: boolean;
}

const SUBJECT_COLORS: Record<string, string> = {
  Polity: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  Geography: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  History: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  Economy: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  Ethics: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  CurrentAffairs: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
};

/** Every failure reason has an executor. */
const REPAIRABLE = new Set<string>(FAILURE_REASONS.map((r) => r.value));

export function PracticeCard({ data, mode }: PracticeCardProps) {
  const showPrelims = mode === "All" || mode === "Prelims";
  const showMains = mode === "All" || mode === "Mains";
  const showInterview = mode === "All" || mode === "Interview";
  const [expanded, setExpanded] = useState<string | null>(null);
  // Prelims
  const [selected, setSelected] = useState<Record<number, string>>({});
  const [postOutcome, setPostOutcome] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [failureReasons, setFailureReasons] = useState<Record<number, string>>({});
  const [repairOpen, setRepairOpen] = useState<Record<number, boolean>>({});
  // Mains
  const [writing, setWriting] = useState<Record<number, boolean>>({});
  const [mainsResult, setMainsResult] = useState<Record<number, EvaluateResponse>>({});
  const [pointsShown, setPointsShown] = useState<Record<number, boolean>>({});

  const toggle = (section: string) => setExpanded((prev) => (prev === section ? null : section));

  // The card shows this concept's whole MCQ inventory, so the reinforcement
  // panel must never serve one of these as "another question".
  const onScreenQuestionIds = data.prelimsMcqs
    .map((m) => m.questionId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const onScreenQuestionIndexes = data.prelimsMcqs.map((_, i) => i);

  const handleSelect = (qIdx: number, answer: string) => {
    if (selected[qIdx] !== undefined) return;
    setSelected((p) => ({ ...p, [qIdx]: answer }));
    setPostOutcome((p) => ({ ...p, [qIdx]: true }));
  };

  /** Confidence (correct) or failure reason (wrong) → one mcq_attempt event. */
  const handlePostOutcome = (qIdx: number, value: number | string) => {
    const answer = selected[qIdx];
    const mcq = data.prelimsMcqs[qIdx];
    if (!answer || !mcq || !postOutcome[qIdx]) return;
    const isCorrect = answer === mcq.correctAnswer;

    setPostOutcome((p) => ({ ...p, [qIdx]: false }));
    setSaving((p) => ({ ...p, [qIdx]: true }));
    if (!isCorrect && typeof value === "string") setFailureReasons((p) => ({ ...p, [qIdx]: value }));

    fetch("/api/revision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conceptId: data.conceptId,
        action: "mcq_attempt",
        quality: isCorrect ? 4 : 1, // SM-2 mapping unchanged
        mcqCorrect: isCorrect,
        mcqQuestionIndex: qIdx,
        mcqQuestionId: mcq.questionId,
        selectedAnswer: answer,
        correctAnswer: mcq.correctAnswer,
        ...(isCorrect ? { confidence: value } : { failureReason: value }),
      }),
    })
      .then((res) => { if (!res.ok) console.warn("[Practice] attempt save failed:", res.status); })
      .catch((err) => console.warn("[Practice] attempt save error:", err))
      .finally(() => setSaving((p) => ({ ...p, [qIdx]: false })));
  };

  /** A marked Mains answer is evidence: record it through the existing review event. */
  const handleMainsEvaluated = (mIdx: number, result: EvaluateResponse) => {
    setMainsResult((p) => ({ ...p, [mIdx]: result }));
    setPointsShown((p) => ({ ...p, [mIdx]: true }));
    fetch("/api/revision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conceptId: data.conceptId,
        action: "review",
        quality: result.quality,
        writtenScore: result.evaluation.score,
        writtenMaxScore: 10,
        answerSource: result.source,
        answerMode: "mains",
        mainsQuestionIndex: mIdx,
        answerExcerpt: result.answerText.slice(0, 300),
      }),
    }).catch((err) => console.warn("[Practice] mains save error:", err));
  };

  /** A spoken interview answer is evidence too: same review event, interview mode. */
  const handleInterviewEvaluated = (result: InterviewResponse, source: "voice" | "typed") => {
    fetch("/api/revision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conceptId: data.conceptId,
        action: "review",
        quality: result.quality,
        writtenScore: result.evaluation.score,
        writtenMaxScore: 10,
        answerSource: source,
        answerMode: "interview",
        answerExcerpt: result.transcript.slice(0, 300),
      }),
    }).catch((err) => console.warn("[Practice] interview save error:", err));
  };

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <h3 className="truncate text-base font-semibold">{data.conceptName}</h3>
            <Badge variant="secondary" className={cn("shrink-0 text-[10px] font-medium", SUBJECT_COLORS[data.subject])}>
              {data.subject}
            </Badge>
          </div>
          <div className="flex shrink-0 gap-1.5 text-[10px] text-muted-foreground">
            {data.prelimsMcqs.length > 0 && <span className="rounded bg-muted px-1.5 py-0.5">{data.prelimsMcqs.length} Prelims</span>}
            {data.mainsQuestions.length > 0 && <span className="rounded bg-muted px-1.5 py-0.5">{data.mainsQuestions.length} Mains</span>}
            {data.interviewPrompts.length > 0 && <span className="rounded bg-muted px-1.5 py-0.5">{data.interviewPrompts.length} Interview</span>}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-2 pt-0">
        {/* ─── Prelims ─── */}
        {showPrelims && data.prelimsMcqs.length > 0 && (
          <Section title="Prelims MCQs" open={expanded === "prelims"} onToggle={() => toggle("prelims")}>
            {data.prelimsMcqs.map((mcq, idx) => {
              const answer = selected[idx];
              const answered = answer !== undefined;
              const isCorrect = answered && answer === mcq.correctAnswer;
              const reason = failureReasons[idx];
              const outcomeDone = answered && !postOutcome[idx];

              return (
                <div key={idx} className="space-y-2">
                  <p className="whitespace-pre-line text-sm font-medium leading-relaxed">Q{idx + 1}. {mcq.question}</p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {(["a", "b", "c", "d"] as const).map((opt) => {
                      const isSel = answer === opt;
                      const isRight = mcq.correctAnswer === opt;
                      return (
                        <button
                          key={opt}
                          onClick={() => handleSelect(idx, opt)}
                          disabled={answered}
                          className={cn(
                            "flex items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                            answered && isRight && "border-green-600/50 bg-green-50 dark:bg-green-500/10",
                            answered && isSel && !isRight && "border-red-600/50 bg-red-50 dark:bg-red-500/10",
                            !answered && "hover:bg-muted/50 cursor-pointer",
                            answered && "cursor-default",
                          )}
                          id={`mcq-${idx}-${opt}`}
                        >
                          <span className="w-5 shrink-0 text-xs font-semibold text-muted-foreground">({opt})</span>
                          <span>{mcq.options[opt]}</span>
                        </button>
                      );
                    })}
                  </div>

                  {answered && postOutcome[idx] && (
                    <div className="rounded-md border border-border px-3 py-2.5">
                      <p className="mb-2 text-xs font-semibold">
                        {isCorrect ? "Correct. How confident were you?" : `Incorrect. Answer: (${mcq.correctAnswer}). What went wrong?`}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {(isCorrect ? POST_OUTCOME_CONFIDENCE : FAILURE_REASONS).map((o) => (
                          <button
                            key={String(o.value)}
                            onClick={() => handlePostOutcome(idx, o.value)}
                            className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted/60 transition-colors"
                            id={`mcq-${isCorrect ? "confidence" : "failure"}-${o.value}-${idx}`}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {saving[idx] && <p className="text-[10px] text-muted-foreground">Saving…</p>}

                  {answered && (
                    <div className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground">Explanation: </span>
                      {mcq.explanation}
                    </div>
                  )}

                  {outcomeDone && !isCorrect && reason && REPAIRABLE.has(reason) && !repairOpen[idx] && (
                    <button
                      onClick={() => setRepairOpen((p) => ({ ...p, [idx]: true }))}
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/60 transition-colors"
                      id={`repair-request-${idx}`}
                    >
                      {REPAIR_CTA_LABEL[reason]}
                    </button>
                  )}

                  {repairOpen[idx] && reason && (
                    <RepairFlow
                      conceptId={data.conceptId}
                      failureReason={reason}
                      questionContext={{
                        questionIndex: idx,
                        selectedAnswer: answer,
                        correctAnswer: mcq.correctAnswer,
                        questionText: mcq.question,
                        ...(mcq.questionId ? { questionId: mcq.questionId } : {}),
                      }}
                      excludeQuestionIds={onScreenQuestionIds}
                      excludeQuestionIndexes={onScreenQuestionIndexes}
                    />
                  )}
                </div>
              );
            })}
          </Section>
        )}

        {/* ─── Mains ─── */}
        {showMains && data.mainsQuestions.length > 0 && (
          <Section title="Mains questions" open={expanded === "mains"} onToggle={() => toggle("mains")}>
            {data.mainsQuestions.map((q, idx) => (
              <div key={idx} className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium leading-relaxed">{q.question}</p>
                  <Badge variant="outline" className="shrink-0 text-[10px]">{q.estimatedMarks} marks</Badge>
                </div>

                {!writing[idx] && !mainsResult[idx] && (
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      onClick={() => setWriting((p) => ({ ...p, [idx]: true }))}
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                      id={`mains-write-${idx}`}
                    >
                      Write answer
                    </button>
                    <button
                      onClick={() => setPointsShown((p) => ({ ...p, [idx]: !p[idx] }))}
                      className="text-xs text-muted-foreground hover:text-foreground"
                      id={`mains-points-${idx}`}
                    >
                      {pointsShown[idx] ? "Hide marking points" : "Show marking points without writing"}
                    </button>
                  </div>
                )}

                {writing[idx] && (
                  <WrittenAnswer
                    conceptId={data.conceptId}
                    mode="mains"
                    question={q.question}
                    reference={q.guidancePoints}
                    marks={q.estimatedMarks}
                    onEvaluated={(r) => handleMainsEvaluated(idx, r)}
                    idPrefix={`mains-${idx}`}
                  />
                )}

                {pointsShown[idx] && q.guidancePoints.length > 0 && (
                  <div className="rounded-md border border-border px-3 py-2">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Marking points</p>
                    <ul className="space-y-0.5">
                      {q.guidancePoints.map((gp, i) => (
                        <li key={i} className="flex gap-1.5 text-xs text-muted-foreground">
                          <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                          {gp}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </Section>
        )}

        {/* ─── Interview ─── */}
        {showInterview && data.interviewPrompts.length > 0 && (
          <Section title="Interview prompts" open={expanded === "interview"} onToggle={() => toggle("interview")}>
            {data.interviewPrompts.map((p, idx) => (
              <div key={idx} className="space-y-2">
                <p className="text-sm font-medium leading-relaxed">{p.prompt}</p>
                {p.expectedDimensions.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">Dimensions: {p.expectedDimensions.join(", ")}</p>
                )}
                <VoiceAnswer
                  conceptId={data.conceptId}
                  prompt={p.prompt}
                  dimensions={p.expectedDimensions}
                  onEvaluated={(r, source) => handleInterviewEvaluated(r, source)}
                  idPrefix={`interview-${idx}`}
                />
              </div>
            ))}
          </Section>
        )}
      </CardContent>
    </Card>
  );
}

function Section({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60">
      <button onClick={onToggle} className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium hover:bg-muted/30 transition-colors">
        <span>{title}</span>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && <div className="space-y-5 border-t px-4 py-3">{children}</div>}
    </div>
  );
}
