"use client";

/**
 * PracticeCard — Displays questions for a single concept.
 * Progressive disclosure: expand sections on demand.
 * Clean, exam-focused, zero gamification.
 *
 * Post-R2 Architecture:
 *   Correct → "How did you feel?" → confidence (1-3)
 *   Wrong   → "What went wrong?" → failureReason
 *   Both captured AFTER outcome, part of MCQ interaction.
 *   SM-2 quality derivation unchanged: correct→4, incorrect→1.
 */

import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  HelpCircle,
  FileText,
  Mic,
  BookOpen,
  Loader2,
  Lightbulb,
  ArrowRight,
  Brain,
  Search,
  Scale,
  Target,
  Compass,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  decideNextAction,
  applyReofferLimit,
  MAX_ADDITIONAL_REPAIR_OFFERS,
} from "@/lib/repair/repair-next-action";
import type { RepairNextAction } from "@/lib/repair/repair-next-action";
import type { PostRepairUnderstanding } from "@/lib/evidence/evidence.types";

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

// ─── Post-outcome confidence (correct MCQ only) ─────────────

const POST_OUTCOME_CONFIDENCE = [
  { value: 1, label: "It was a guess", emoji: "🎲" },
  { value: 2, label: "I was somewhat confident", emoji: "🤔" },
  { value: 3, label: "I was confident", emoji: "✓" },
] as const;

// ─── Failure reason (wrong MCQ only) ────────────────────────

const FAILURE_REASONS = [
  { value: "concept_not_understood", label: "I didn\u2019t understand the concept", emoji: "📚" },
  { value: "could_not_recall", label: "I knew it, but couldn\u2019t recall it", emoji: "💭" },
  { value: "misunderstood_question", label: "I misunderstood the question/options", emoji: "🔍" },
  { value: "guessed", label: "I wasn\u2019t sure and guessed", emoji: "🎲" },
  { value: "overconfident", label: "I was confident, but got it wrong", emoji: "😯" },
  { value: "careless_mistake", label: "I made a careless mistake", emoji: "⚡" },
  { value: "not_sure", label: "I\u2019m not sure", emoji: "🤷" },
] as const;

// ─── Post-repair self-assessment (R3.3) ─────────────────────
//
// Asked after the repair's verification MCQ has been answered and revealed,
// regardless of whether that answer was right or wrong.
//
// Order is fixed and presentational — these are opaque student-reported
// categories, not a 1-3 scale and not a grade. Nothing reads them back to
// decide whether the concept is resolved.

const POST_REPAIR_UNDERSTANDING = [
  { value: "understood", label: "I understand it", emoji: "💡" },
  { value: "somewhat_unsure", label: "I\u2019m somewhat unsure", emoji: "🤔" },
  { value: "still_not_understood", label: "I still don\u2019t understand it", emoji: "❓" },
] as const;

// ─── Repair types (inline — avoids importing server-only modules) ──

interface RepairExplanation {
  coreIdea: string;
  whyItMatters: string;
  example: string | null;
  keyDistinction: string | null;
}

interface RepairVerification {
  question: string;
  options: { a: string; b: string; c: string; d: string };
  correctAnswer: string;
  explanation: string;
}

/** R3.5: the retrieval attempt, shown before anything is revealed. */
interface RepairRetrieval {
  prompt: string;
  cue: string | null;
}

/** R3.5: what the student sees after attempting retrieval. */
interface RepairReveal {
  expectedAnswer: string;
  feedback: string;
}

/** Fields every repair carries, whatever its intent. */
interface RepairCommon {
  requestId: string;
  conceptId: string;
  /** R3.1 signals echoed back by /api/repair — needed to verify the repair (R3.3). */
  failureReason: string;
  /** Both intents verify through the same R3.3 mechanism. */
  verification: RepairVerification;
}

/** R3.2a — the student did not understand the concept. */
interface ConceptTeachingRepairData extends RepairCommon {
  repairIntent: "concept_teaching";
  explanation: RepairExplanation;
}

/** R3.5 — the student understood it but could not retrieve it. */
interface ActiveRecallRepairData extends RepairCommon {
  repairIntent: "active_recall";
  retrieval: RepairRetrieval;
  reveal: RepairReveal;
}

/** R3.6 — the student misread what the question was asking. */
interface QuestionInterpretationRepairData extends RepairCommon {
  repairIntent: "question_interpretation";
  breakdown: {
    whatItAsked: string;
    decisiveWording: string;
    whyYourAnswerMissed: string | null;
    whatToLookFor: string;
  };
}

/** R3.7 — the student was unsure and guessed. */
interface UncertaintyResolutionRepairData extends RepairCommon {
  repairIntent: "uncertainty_resolution";
  breakdown: {
    keyDistinction: string;
    whyBetterSupported: string;
    competingOption: string | null;
    howToDecide: string;
  };
}

/** R3.8 — the student was confident but wrong. */
interface CalibrationRepairData extends RepairCommon {
  repairIntent: "calibration";
  breakdown: {
    whatYouBelieved: string;
    whatWasActuallyCorrect: string;
    whereConfidenceBroke: string | null;
    selfCheck: string;
  };
}

/** R3.9 — the student made a careless/process mistake. */
interface ErrorAwarenessRepairData extends RepairCommon {
  repairIntent: "error_awareness";
  breakdown: {
    whatWasOverlooked: string;
    theTrap: string;
    checkingStep: string | null;
    patternAwareness: string;
  };
}

/** R3.10 — the student doesn't know what went wrong. No verification. */
interface ClarificationRepairData {
  requestId: string;
  conceptId: string;
  failureReason: string;
  repairIntent: "clarification";
  breakdown: {
    whatTheQuestionNeeded: string;
    possibleStumblingPoints: string[];
    howToNarrowItDown: string | null;
    nextTimeStrategy: string;
  };
  verification: null;
}

type RepairData =
  | ConceptTeachingRepairData
  | ActiveRecallRepairData
  | QuestionInterpretationRepairData
  | UncertaintyResolutionRepairData
  | CalibrationRepairData
  | ErrorAwarenessRepairData
  | ClarificationRepairData;

/** Header shown at the top of the repair card, per repair mode. */
const REPAIR_MODES = {
  concept_teaching: { icon: Lightbulb, title: "Targeted Explanation" },
  active_recall: { icon: Brain, title: "Try to Recall This" },
  question_interpretation: { icon: Search, title: "What This Question Asked" },
  uncertainty_resolution: { icon: Scale, title: "How To Choose Confidently" },
  calibration: { icon: Target, title: "Confidence Check" },
  error_awareness: { icon: AlertTriangle, title: "What Was Overlooked" },
  clarification: { icon: Compass, title: "Finding What Went Wrong" },
} as const;

/** One labelled block inside the repair card. */
interface RepairBlock {
  label: string;
  text: string;
  italic?: boolean;
}

/**
 * The labelled blocks a repair renders, per intent.
 *
 * For active_recall these are the POST-reveal blocks — the retrieval prompt is
 * rendered separately because it must appear before the student sees them.
 */
function repairBlocks(repair: RepairData): RepairBlock[] {
  switch (repair.repairIntent) {
    case "concept_teaching":
      return [
        { label: "Core Idea", text: repair.explanation.coreIdea },
        { label: "Why It Matters", text: repair.explanation.whyItMatters },
        ...(repair.explanation.example
          ? [{ label: "Example", text: repair.explanation.example, italic: true }]
          : []),
        ...(repair.explanation.keyDistinction
          ? [{ label: "Key Distinction", text: repair.explanation.keyDistinction }]
          : []),
      ];
    case "active_recall":
      return [
        { label: "Answer", text: repair.reveal.expectedAnswer },
        { label: "How Did You Do?", text: repair.reveal.feedback },
      ];
    case "question_interpretation":
      return [
        { label: "What It Asked", text: repair.breakdown.whatItAsked },
        { label: "The Wording That Decided It", text: repair.breakdown.decisiveWording },
        ...(repair.breakdown.whyYourAnswerMissed
          ? [{ label: "Why Your Answer Missed", text: repair.breakdown.whyYourAnswerMissed }]
          : []),
        { label: "What To Look For Next Time", text: repair.breakdown.whatToLookFor },
      ];
    case "uncertainty_resolution":
      return [
        { label: "Key Distinction", text: repair.breakdown.keyDistinction },
        { label: "Why It's Better Supported", text: repair.breakdown.whyBetterSupported },
        ...(repair.breakdown.competingOption
          ? [{ label: "The Tempting Option", text: repair.breakdown.competingOption }]
          : []),
        { label: "How To Decide Next Time", text: repair.breakdown.howToDecide },
      ];
    case "calibration":
      return [
        { label: "What You Believed", text: repair.breakdown.whatYouBelieved },
        { label: "What Was Actually Correct", text: repair.breakdown.whatWasActuallyCorrect },
        ...(repair.breakdown.whereConfidenceBroke
          ? [{ label: "Where Confidence Broke", text: repair.breakdown.whereConfidenceBroke }]
          : []),
        { label: "Self-Check For Next Time", text: repair.breakdown.selfCheck },
      ];
    case "error_awareness":
      return [
        { label: "What Was Overlooked", text: repair.breakdown.whatWasOverlooked },
        { label: "The Trap", text: repair.breakdown.theTrap },
        ...(repair.breakdown.checkingStep
          ? [{ label: "Checking Step", text: repair.breakdown.checkingStep }]
          : []),
        { label: "Pattern To Watch For", text: repair.breakdown.patternAwareness },
      ];
    case "clarification":
      return [
        { label: "What The Question Needed", text: repair.breakdown.whatTheQuestionNeeded },
        ...repair.breakdown.possibleStumblingPoints.map((point, i) => ({
          label: `Possible Stumbling Point ${i + 1}`,
          text: point,
        })),
        ...(repair.breakdown.howToNarrowItDown
          ? [{ label: "How To Narrow It Down", text: repair.breakdown.howToNarrowItDown }]
          : []),
        { label: "Strategy For Next Time", text: repair.breakdown.nextTimeStrategy },
      ];
  }
}

/** Renders one labelled block. Same markup the card has always used. */
function RepairFieldBlock({ label, text, italic }: RepairBlock) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-600/70 dark:text-blue-400/70 mb-0.5">{label}</p>
      <p className={cn("text-xs leading-relaxed text-foreground", italic && "italic")}>{text}</p>
    </div>
  );
}

/**
 * Failure reasons that currently have a repair executor.
 * Mirrors the intents /api/repair can route (concept_teaching, active_recall).
 */
const REPAIRABLE_FAILURE_REASONS = [
  "concept_not_understood",
  "could_not_recall",
  "misunderstood_question",
  "guessed",
  "overconfident",
  "careless_mistake",
  "not_sure",
] as const;

/** The repair CTA speaks the student's own language for each reason. */
const REPAIR_CTA_LABEL: Record<string, string> = {
  concept_not_understood: "Help me understand this concept",
  could_not_recall: "Help me recall this",
  misunderstood_question: "Break down what this question asked",
  guessed: "Help me choose confidently next time",
  overconfident: "Show me where my confidence was wrong",
  careless_mistake: "Show me what I overlooked",
  not_sure: "Help me figure out what went wrong",
};

export function PracticeCard({ data, mode }: PracticeCardProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
  const [showExplanation, setShowExplanation] = useState<Record<number, boolean>>({});
  const [submittingIdx, setSubmittingIdx] = useState<Record<number, boolean>>({});

  // Post-outcome state: waiting for student feedback before saving
  const [postOutcomeIdx, setPostOutcomeIdx] = useState<Record<number, boolean>>({});
  // Track which questions have completed the full flow
  const [completedIdx, setCompletedIdx] = useState<Record<number, boolean>>({});
  // Track which questions had concept_not_understood selected
  const [failureReasons, setFailureReasons] = useState<Record<number, string>>({});

  // ─── R3.2a Repair state ─────────────────────────────────
  const [repairLoading, setRepairLoading] = useState<Record<number, boolean>>({});
  const [repairData, setRepairData] = useState<Record<number, RepairData>>({});
  const [repairError, setRepairError] = useState<Record<number, string>>({});
  // Verification answer state within the repair
  const [verificationAnswer, setVerificationAnswer] = useState<Record<number, string>>({});
  const [verificationRevealed, setVerificationRevealed] = useState<Record<number, boolean>>({});
  // ─── R3.3 Verification persistence state ────────────────
  // R3.5: has the student attempted recall and asked to see the answer?
  const [recallRevealed, setRecallRevealed] = useState<Record<number, boolean>>({});
  const [verificationSaving, setVerificationSaving] = useState<Record<number, boolean>>({});
  const [verificationSaveFailed, setVerificationSaveFailed] = useState<Record<number, boolean>>({});
  // ─── R3.3 Post-repair self-assessment state ─────────────
  const [understandingAnswer, setUnderstandingAnswer] = useState<Record<number, string>>({});
  const [understandingSaving, setUnderstandingSaving] = useState<Record<number, boolean>>({});
  const [understandingSaveFailed, setUnderstandingSaveFailed] = useState<Record<number, boolean>>({});
  // ─── R3.4 Next action ───────────────────────────────────
  // Derived from the two recorded facts, never persisted. `reoffersUsed`
  // is a session-local budget so a repeated "I still don't understand it"
  // cannot loop on AI calls forever.
  const [nextAction, setNextAction] = useState<Record<number, RepairNextAction>>({});
  const [reoffersUsed, setReoffersUsed] = useState<Record<number, number>>({});

  /** Drop one question index from a per-question state map. */
  const clearIdx = <T,>(prev: Record<number, T>, qIdx: number): Record<number, T> => {
    const next = { ...prev };
    delete next[qIdx];
    return next;
  };

  const toggle = (section: string) =>
    setExpandedSection((prev) => (prev === section ? null : section));

  /**
   * Post-R2: Single-step answer flow:
   * 1. Student picks an option → immediately lock answer + reveal outcome
   * 2. Show post-outcome prompt (confidence or failureReason)
   * 3. Student selects one → fire API with all evidence
   *
   * SM-2 quality is still derived from correctness only (correct→4, incorrect→1).
   */
  const handleMCQSelect = (qIdx: number, answer: string) => {
    const mcq = data.prelimsMcqs[qIdx];
    if (!mcq) return;

    // Lock the answer and reveal outcome immediately
    setSelectedAnswers((prev) => ({ ...prev, [qIdx]: answer }));
    setShowExplanation((prev) => ({ ...prev, [qIdx]: true }));
    // Mark as waiting for post-outcome feedback
    setPostOutcomeIdx((prev) => ({ ...prev, [qIdx]: true }));
  };

  /**
   * Post-outcome: Student selects confidence (correct) or failureReason (wrong).
   * This triggers the API call with all evidence.
   */
  const handlePostOutcomeSelect = (qIdx: number, value: number | string) => {
    const answer = selectedAnswers[qIdx];
    const mcq = data.prelimsMcqs[qIdx];
    if (!answer || !mcq) return;

    const isCorrect = answer === mcq.correctAnswer;
    // SM-2 quality mapping: correct = 4, incorrect = 1 (UNCHANGED)
    const quality = isCorrect ? 4 : 1;

    // Mark as completed, hide the post-outcome prompt
    setPostOutcomeIdx((prev) => ({ ...prev, [qIdx]: false }));
    setCompletedIdx((prev) => ({ ...prev, [qIdx]: true }));
    setSubmittingIdx((prev) => ({ ...prev, [qIdx]: true }));

    // Track failure reason for repair eligibility
    if (!isCorrect && typeof value === "string") {
      setFailureReasons((prev) => ({ ...prev, [qIdx]: value }));
    }

    // Build the request body
    const body: Record<string, unknown> = {
      conceptId: data.conceptId,
      action: "mcq_attempt",
      quality,
      mcqCorrect: isCorrect,
      mcqQuestionIndex: qIdx,
      mcqQuestionId: mcq.questionId,
      selectedAnswer: answer,
      correctAnswer: mcq.correctAnswer,
    };

    if (isCorrect) {
      // Confidence for correct attempts
      body.confidence = value as number;
    } else {
      // Failure reason for wrong attempts
      body.failureReason = value as string;
    }

    fetch("/api/revision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((res) => {
        if (!res.ok) console.warn("[Practice] Mastery update failed:", res.status);
      })
      .catch((err) => {
        console.warn("[Practice] Mastery update error:", err);
      })
      .finally(() => {
        setSubmittingIdx((prev) => ({ ...prev, [qIdx]: false }));
      });
  };

  /**
   * R3.2a / R3.5: Fetch the repair for a wrong MCQ.
   *
   * The student's own failureReason is sent verbatim and decides which
   * executor runs server-side — concept_not_understood → concept_teaching,
   * could_not_recall → active_recall. It is never substituted here.
   */
  const handleRequestRepair = (qIdx: number) => {
    const mcq = data.prelimsMcqs[qIdx];
    if (!mcq) return;

    const failureReason = failureReasons[qIdx];
    if (!failureReason) return;

    setRepairLoading((prev) => ({ ...prev, [qIdx]: true }));
    setRepairError((prev) => ({ ...prev, [qIdx]: "" }));

    fetch("/api/repair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conceptId: data.conceptId,
        failureReason,
        questionContext: {
          questionIndex: qIdx,
          selectedAnswer: selectedAnswers[qIdx],
          correctAnswer: mcq.correctAnswer,
          questionText: mcq.question,
          questionId: mcq.questionId,
        },
      }),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error?.message || "Repair request failed");
        }
        setRepairData((prev) => ({ ...prev, [qIdx]: json.data.repair }));
      })
      .catch((err) => {
        setRepairError((prev) => ({ ...prev, [qIdx]: err.message || "Something went wrong" }));
      })
      .finally(() => {
        setRepairLoading((prev) => ({ ...prev, [qIdx]: false }));
      });
  };

  /**
   * R3.3: Student answers the post-repair verification MCQ.
   *
   * Grades and reveals immediately (local, instant), then persists the
   * outcome as a `repair_verification` event.
   *
   * The same R3.1 requestId returned by /api/repair is sent back, so the
   * verification stays correlated with the repair it measures.
   *
   * This does NOT touch SM-2 — /api/repair/verify writes an append-only
   * evidence event and never enters the scheduling path.
   */
  const handleVerificationSelect = (qIdx: number, opt: string) => {
    const repair = repairData[qIdx];
    if (!repair) return;

    // Clarification repairs have verification: null — this handler is never
    // called for them (no MCQ rendered), but TypeScript needs the narrowing.
    if (!repair.verification) return;

    // Duplicate guard: one verification per repair, first answer wins.
    if (verificationAnswer[qIdx] || verificationSaving[qIdx]) return;

    // 1 + 2. Grade and reveal locally — never blocked on the network.
    setVerificationAnswer((prev) => ({ ...prev, [qIdx]: opt }));
    setVerificationRevealed((prev) => ({ ...prev, [qIdx]: true }));
    setVerificationSaving((prev) => ({ ...prev, [qIdx]: true }));
    setVerificationSaveFailed((prev) => ({ ...prev, [qIdx]: false }));

    const mcq = data.prelimsMcqs[qIdx];

    // 3. Persist the verification outcome as evidence.
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
        questionContext: {
          questionIndex: qIdx,
          ...(mcq?.questionId ? { questionId: mcq.questionId } : {}),
        },
        verificationQuestion: repair.verification.question,
      }),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          throw new Error(json?.error?.message || "Verification save failed");
        }
      })
      .catch((err) => {
        // 5. Never break the practice experience — the student keeps their
        // graded result and explanation; only the evidence write is lost.
        console.warn("[Practice] Repair verification save failed:", err);
        setVerificationSaveFailed((prev) => ({ ...prev, [qIdx]: true }));
      })
      .finally(() => {
        setVerificationSaving((prev) => ({ ...prev, [qIdx]: false }));
      });
  };

  /**
   * R3.3: Student reports how they feel about the concept after the repair.
   *
   * Sends ONLY { requestId, postRepairUnderstanding }. The server derives the
   * concept, the original failureReason and the repairIntent from the
   * repair_verification event it already stored under the same requestId —
   * this component never asserts them.
   *
   * This does NOT touch SM-2, and nothing here decides whether the concept is
   * resolved. It records one fact: what the student said.
   */
  const handleUnderstandingSelect = (qIdx: number, value: PostRepairUnderstanding) => {
    const repair = repairData[qIdx];
    if (!repair) return;

    // Clarification repairs skip verification entirely — this handler is
    // unreachable for them, but TypeScript needs the narrowing.
    if (!repair.verification) return;

    // Duplicate guard: one self-report per repair, first answer wins.
    if (understandingAnswer[qIdx] || understandingSaving[qIdx]) return;

    // 1 + 2. Show the selection immediately — never blocked on the network.
    setUnderstandingAnswer((prev) => ({ ...prev, [qIdx]: value }));
    setUnderstandingSaving((prev) => ({ ...prev, [qIdx]: true }));
    setUnderstandingSaveFailed((prev) => ({ ...prev, [qIdx]: false }));

    // R3.4: decide what happens next from the two facts we now hold. Pure and
    // local — it needs no network, so it is not gated on the save succeeding.
    setNextAction((prev) => ({
      ...prev,
      [qIdx]: applyReofferLimit(
        decideNextAction({
          verificationCorrect: verificationAnswer[qIdx] === repair.verification.correctAnswer,
          postRepairUnderstanding: value,
        }),
        reoffersUsed[qIdx] ?? 0,
      ),
    }));

    // 3. Persist the report as its own append-only evidence event.
    fetch("/api/repair/understanding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: repair.requestId,
        postRepairUnderstanding: value,
      }),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          throw new Error(json?.error?.message || "Self-assessment save failed");
        }
      })
      .catch((err) => {
        // 5 + 6 + 7. No retry, no blocking: the student keeps their selection
        // and the rest of practice is unaffected; only the write is lost.
        console.warn("[Practice] Post-repair understanding save failed:", err);
        setUnderstandingSaveFailed((prev) => ({ ...prev, [qIdx]: true }));
      })
      .finally(() => {
        setUnderstandingSaving((prev) => ({ ...prev, [qIdx]: false }));
      });
  };

  /**
   * R3.4: Serve the one extra repair this question is allowed.
   *
   * Clears the completed loop for this question so the fresh repair starts
   * clean, then reuses handleRequestRepair — which mints a new R3.1 requestId
   * server-side, so the second attempt records its own independent
   * verification and understanding events.
   *
   * The budget is session-local: nothing is persisted and no event is written.
   */
  const handleAnotherRepair = (qIdx: number) => {
    if ((reoffersUsed[qIdx] ?? 0) >= MAX_ADDITIONAL_REPAIR_OFFERS) return;
    if (repairLoading[qIdx]) return;

    setReoffersUsed((prev) => ({ ...prev, [qIdx]: (prev[qIdx] ?? 0) + 1 }));

    setRepairData((prev) => clearIdx(prev, qIdx));
    setVerificationAnswer((prev) => clearIdx(prev, qIdx));
    setVerificationRevealed((prev) => clearIdx(prev, qIdx));
    setRecallRevealed((prev) => clearIdx(prev, qIdx));
    setVerificationSaveFailed((prev) => clearIdx(prev, qIdx));
    setUnderstandingAnswer((prev) => clearIdx(prev, qIdx));
    setUnderstandingSaveFailed((prev) => clearIdx(prev, qIdx));
    setNextAction((prev) => clearIdx(prev, qIdx));

    handleRequestRepair(qIdx);
  };

  const showPrelims = mode === "All" || mode === "Prelims";
  const showMains = mode === "All" || mode === "Mains";
  const showInterview = mode === "All" || mode === "Interview";

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <h3 className="text-base font-semibold">{data.conceptName}</h3>
            <Badge
              variant="secondary"
              className={cn("text-[10px] font-medium", SUBJECT_COLORS[data.subject])}
            >
              {data.subject}
            </Badge>
          </div>
          <div className="flex gap-1.5 text-[10px] text-muted-foreground">
            {data.prelimsMcqs.length > 0 && (
              <span className="rounded bg-muted px-1.5 py-0.5">{data.prelimsMcqs.length} MCQ</span>
            )}
            {data.mainsQuestions.length > 0 && (
              <span className="rounded bg-muted px-1.5 py-0.5">{data.mainsQuestions.length} Mains</span>
            )}
            {data.interviewPrompts.length > 0 && (
              <span className="rounded bg-muted px-1.5 py-0.5">{data.interviewPrompts.length} Interview</span>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-2 pt-0">
        {/* ─── Prelims MCQs ─────────────────────────────────── */}
        {showPrelims && data.prelimsMcqs.length > 0 && (
          <div className="rounded-lg border border-border/40">
            <button
              onClick={() => toggle("prelims")}
              className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/30 transition-colors"
            >
              <span className="flex items-center gap-2">
                <HelpCircle className="h-3.5 w-3.5 text-blue-500" />
                Prelims MCQs
              </span>
              {expandedSection === "prelims" ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>

            {expandedSection === "prelims" && (
              <div className="space-y-4 border-t px-4 py-3">
                {data.prelimsMcqs.map((mcq, idx) => {
                  const answered = selectedAnswers[idx] !== undefined;
                  const isLocked = answered;
                  const isCorrectAnswer = answered && selectedAnswers[idx] === mcq.correctAnswer;
                  const showPostOutcome = postOutcomeIdx[idx] === true;
                  const isCompleted = completedIdx[idx] === true;
                  // Bound locally so the RepairData union narrows on repairIntent.
                  const repair = repairData[idx];
                  const failureReason = failureReasons[idx];
                  const isRepairable = (REPAIRABLE_FAILURE_REASONS as readonly string[]).includes(
                    failureReason,
                  );

                  return (
                    <div key={idx} className="space-y-2">
                      <p className="text-sm font-medium leading-relaxed">
                        Q{idx + 1}. {mcq.question}
                      </p>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {(["a", "b", "c", "d"] as const).map((opt) => {
                          const selected = selectedAnswers[idx] === opt;
                          const isCorrect = mcq.correctAnswer === opt;

                          return (
                            <button
                              key={opt}
                              onClick={() => !isLocked && handleMCQSelect(idx, opt)}
                              disabled={isLocked}
                              className={cn(
                                "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                                // After outcome revealed: green for correct, red for wrong selection
                                answered && isCorrect && "border-green-500/50 bg-green-50 dark:bg-green-500/10",
                                answered && selected && !isCorrect && "border-red-500/50 bg-red-50 dark:bg-red-500/10",
                                // Default interactive state
                                !isLocked && "hover:bg-muted/50 cursor-pointer",
                                isLocked && "cursor-default"
                              )}
                            >
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold">
                                {opt.toUpperCase()}
                              </span>
                              <span>{mcq.options[opt]}</span>
                              {answered && isCorrect && <CheckCircle2 className="ml-auto h-4 w-4 text-green-600 shrink-0" />}
                              {answered && selected && !isCorrect && <XCircle className="ml-auto h-4 w-4 text-red-500 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>

                      {/* ─── Post-outcome feedback ───────────── */}
                      {showPostOutcome && (
                        <div className={cn(
                          "rounded-md border px-3 py-3 animate-in fade-in slide-in-from-top-1 duration-200",
                          isCorrectAnswer
                            ? "bg-green-50/80 dark:bg-green-500/5 border-green-200/50 dark:border-green-500/20"
                            : "bg-red-50/80 dark:bg-red-500/5 border-red-200/50 dark:border-red-500/20"
                        )}>
                          <p className={cn(
                            "text-xs font-semibold mb-2.5",
                            isCorrectAnswer
                              ? "text-green-700 dark:text-green-300"
                              : "text-red-700 dark:text-red-300"
                          )}>
                            {isCorrectAnswer ? "How did you feel about this answer?" : "What went wrong?"}
                          </p>

                          <div className="space-y-1.5">
                            {isCorrectAnswer ? (
                              // Correct → confidence options
                              POST_OUTCOME_CONFIDENCE.map((level) => (
                                <button
                                  key={level.value}
                                  onClick={() => handlePostOutcomeSelect(idx, level.value)}
                                  className="flex w-full items-center gap-2.5 rounded-md border border-green-200/60 dark:border-green-500/20 bg-white dark:bg-green-950/30 px-3 py-2 text-left text-xs font-medium text-green-800 dark:text-green-200 hover:bg-green-100/80 dark:hover:bg-green-500/15 transition-colors"
                                  id={`mcq-confidence-${level.value}-${idx}`}
                                >
                                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-green-300/60 dark:border-green-500/30 text-sm">
                                    {level.emoji}
                                  </span>
                                  <span>{level.label}</span>
                                </button>
                              ))
                            ) : (
                              // Wrong → failure reason options
                              FAILURE_REASONS.map((reason) => (
                                <button
                                  key={reason.value}
                                  onClick={() => handlePostOutcomeSelect(idx, reason.value)}
                                  className="flex w-full items-center gap-2.5 rounded-md border border-red-200/60 dark:border-red-500/20 bg-white dark:bg-red-950/30 px-3 py-2 text-left text-xs font-medium text-red-800 dark:text-red-200 hover:bg-red-100/80 dark:hover:bg-red-500/15 transition-colors"
                                  id={`mcq-failure-${reason.value}-${idx}`}
                                >
                                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-red-300/60 dark:border-red-500/30 text-sm">
                                    {reason.emoji}
                                  </span>
                                  <span>{reason.label}</span>
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      )}

                      {/* ─── Completion indicator ────────────── */}
                      {isCompleted && submittingIdx[idx] && (
                        <p className="text-[10px] text-muted-foreground animate-pulse">Saving…</p>
                      )}

                      {showExplanation[idx] && (
                        <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground leading-relaxed">
                          <span className="font-medium text-foreground">Explanation:</span> {mcq.explanation}
                        </div>
                      )}

                      {/* ─── R3.2a: Concept Teaching Repair ──── */}
                      {isCompleted && isRepairable && !repair && (
                        <div className="rounded-md border border-amber-200/60 dark:border-amber-500/20 bg-amber-50/50 dark:bg-amber-500/5 px-3 py-2.5">
                          <button
                            onClick={() => handleRequestRepair(idx)}
                            disabled={repairLoading[idx]}
                            className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 transition-colors disabled:opacity-50"
                            id={`repair-request-${idx}`}
                          >
                            {repairLoading[idx] ? (
                              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating explanation…</>
                            ) : (
                              <><BookOpen className="h-3.5 w-3.5" /> {REPAIR_CTA_LABEL[failureReason]} <ArrowRight className="h-3 w-3" /></>
                            )}
                          </button>
                          {repairError[idx] && (
                            <p className="mt-1.5 text-[10px] text-red-600 dark:text-red-400">{repairError[idx]}</p>
                          )}
                        </div>
                      )}

                      {/* ─── Repair card (R3.2a teaching / R3.5 recall) ── */}
                      {repair && (
                        <div className="space-y-3 rounded-lg border border-blue-200/60 dark:border-blue-500/20 bg-blue-50/30 dark:bg-blue-500/5 px-4 py-3 animate-in fade-in slide-in-from-top-2 duration-300">
                          {/* Repair mode header — one line per intent. */}
                          {(() => {
                            const ModeIcon = REPAIR_MODES[repair.repairIntent].icon;
                            return (
                              <div className="flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-300">
                                <ModeIcon className="h-3.5 w-3.5" />
                                {REPAIR_MODES[repair.repairIntent].title}
                              </div>
                            );
                          })()}

                          {repair.repairIntent === "active_recall" ? (
                            <>
                              {/* ─── R3.5: Retrieval first, answer second ── */}
                              <div>
                                <p className="text-xs leading-relaxed text-foreground font-medium">{repair.retrieval.prompt}</p>
                                {repair.retrieval.cue && (
                                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                                    <span className="font-medium">Cue:</span> {repair.retrieval.cue}
                                  </p>
                                )}
                              </div>

                              {!recallRevealed[idx] ? (
                                <div>
                                  <p className="mb-1.5 text-[11px] text-muted-foreground">
                                    Answer it in your head first — then check yourself.
                                  </p>
                                  <button
                                    onClick={() => setRecallRevealed((prev) => ({ ...prev, [idx]: true }))}
                                    className="flex items-center gap-2 text-xs font-medium text-blue-700 dark:text-blue-300 hover:text-blue-900 dark:hover:text-blue-100 transition-colors"
                                    id={`repair-recall-reveal-${idx}`}
                                  >
                                    <ArrowRight className="h-3.5 w-3.5" /> Show me the answer
                                  </button>
                                </div>
                              ) : (
                                <div className="space-y-3 animate-in fade-in duration-200">
                                  {repairBlocks(repair).map((block) => (
                                    <RepairFieldBlock key={block.label} {...block} />
                                  ))}
                                </div>
                              )}
                            </>
                          ) : (
                            repairBlocks(repair).map((block) => (
                              <RepairFieldBlock key={block.label} {...block} />
                            ))
                          )}

                          {/* Clarification special case — no verification */}
                          {repair.repairIntent === "clarification" && (
                            <p className="mt-2.5 flex items-center gap-1.5 text-[11px] font-medium text-blue-700 dark:text-blue-300">
                              <Compass className="h-3.5 w-3.5 shrink-0" />
                              Use these pointers to identify what specifically blocked you, then try a similar question.
                            </p>
                          )}

                          {/* ─── Verification MCQ (shared R3.3 mechanism) ──
                              For active recall it waits until the student has
                              actually attempted retrieval and seen the answer. */}
                          {repair.verification && (repair.repairIntent !== "active_recall" || recallRevealed[idx]) && (
                          <div className="mt-2 rounded-md border border-blue-200/50 dark:border-blue-500/15 bg-white/50 dark:bg-blue-950/20 px-3 py-2.5">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-600/70 dark:text-blue-400/70 mb-2">Let&apos;s Check</p>
                            <p className="text-xs font-medium leading-relaxed mb-2">{repair.verification.question}</p>
                            <div className="grid gap-1.5 sm:grid-cols-2">
                              {(["a", "b", "c", "d"] as const).map((opt) => {
                                const vAnswer = verificationAnswer[idx];
                                const isRevealed = verificationRevealed[idx];
                                const isCorrectOpt = repair.verification.correctAnswer === opt;
                                const isSelected = vAnswer === opt;

                                return (
                                  <button
                                    key={opt}
                                    onClick={() => handleVerificationSelect(idx, opt)}
                                    disabled={!!vAnswer}
                                    className={cn(
                                      "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors",
                                      isRevealed && isCorrectOpt && "border-green-500/50 bg-green-50 dark:bg-green-500/10",
                                      isRevealed && isSelected && !isCorrectOpt && "border-red-500/50 bg-red-50 dark:bg-red-500/10",
                                      !vAnswer && "hover:bg-muted/50 cursor-pointer",
                                      !!vAnswer && "cursor-default",
                                    )}
                                    id={`repair-verify-${opt}-${idx}`}
                                  >
                                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold">
                                      {opt.toUpperCase()}
                                    </span>
                                    <span>{repair.verification.options[opt]}</span>
                                    {isRevealed && isCorrectOpt && <CheckCircle2 className="ml-auto h-4 w-4 text-green-600 shrink-0" />}
                                    {isRevealed && isSelected && !isCorrectOpt && <XCircle className="ml-auto h-4 w-4 text-red-500 shrink-0" />}
                                  </button>
                                );
                              })}
                            </div>
                            {verificationRevealed[idx] && (
                              <div className="mt-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground leading-relaxed">
                                <span className="font-medium text-foreground">
                                  {verificationAnswer[idx] === repair.verification.correctAnswer ? "✓ Correct! " : "✗ Not quite. "}
                                </span>
                                {repair.verification.explanation}
                              </div>
                            )}
                            {/* R3.3: evidence write failed — grading above is unaffected. */}
                            {verificationSaveFailed[idx] && (
                              <p className="mt-1.5 text-[10px] text-muted-foreground">
                                Couldn&apos;t save this result — your answer above still stands.
                              </p>
                            )}

                            {/* ─── R3.3: Post-repair self-assessment ───
                                Shown once the verification result is revealed,
                                whether that answer was right or wrong — the
                                student's report is a separate fact from it. */}
                            {verificationRevealed[idx] && (
                              <div className="mt-2.5 rounded-md border border-blue-200/60 dark:border-blue-500/20 bg-blue-50/60 dark:bg-blue-500/5 px-3 py-2.5 animate-in fade-in slide-in-from-top-1 duration-300">
                                <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-2.5">
                                  How confident do you feel about this concept now?
                                </p>
                                <div className="space-y-1.5">
                                  {POST_REPAIR_UNDERSTANDING.map((option) => {
                                    const answered = !!understandingAnswer[idx];
                                    const isSelected = understandingAnswer[idx] === option.value;

                                    return (
                                      <button
                                        key={option.value}
                                        onClick={() => handleUnderstandingSelect(idx, option.value)}
                                        disabled={answered}
                                        className={cn(
                                          "flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors",
                                          "border-blue-200/60 dark:border-blue-500/20 text-blue-800 dark:text-blue-200",
                                          !answered && "bg-white dark:bg-blue-950/30 hover:bg-blue-100/80 dark:hover:bg-blue-500/15 cursor-pointer",
                                          answered && isSelected && "bg-blue-100/80 dark:bg-blue-500/15 border-blue-400/60 dark:border-blue-400/30 cursor-default",
                                          answered && !isSelected && "bg-white dark:bg-blue-950/30 opacity-50 cursor-default",
                                        )}
                                        id={`repair-understanding-${option.value}-${idx}`}
                                      >
                                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-blue-300/60 dark:border-blue-500/30 text-sm">
                                          {option.emoji}
                                        </span>
                                        <span>{option.label}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                                {/* Evidence write failed — the selection above still stands. */}
                                {understandingSaveFailed[idx] && (
                                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                                    Couldn&apos;t save this — your answer above still stands.
                                  </p>
                                )}
                              </div>
                            )}

                            {/* ─── R3.4: Next action ─────────────────
                                Derived from the verification result and the
                                student's own report. Nothing is persisted and
                                no concept is marked resolved. */}
                            {nextAction[idx] === "repair_complete" && (
                              <p className="mt-2.5 flex items-center gap-1.5 text-[11px] font-medium text-green-700 dark:text-green-300">
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                Repair complete — nothing more to do here for now.
                              </p>
                            )}

                            {nextAction[idx] === "leave_for_revision" && (
                              <p className="mt-2.5 text-[11px] text-muted-foreground">
                                Noted. This concept will come back in your normal revision.
                              </p>
                            )}

                            {nextAction[idx] === "offer_another_repair" && (
                              <div className="mt-2.5">
                                <p className="mb-1.5 text-[11px] text-muted-foreground">
                                  Let&apos;s try explaining this a different way.
                                </p>
                                <button
                                  onClick={() => handleAnotherRepair(idx)}
                                  disabled={repairLoading[idx]}
                                  className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 transition-colors disabled:opacity-50"
                                  id={`repair-retry-${idx}`}
                                >
                                  <BookOpen className="h-3.5 w-3.5" />
                                  {REPAIR_CTA_LABEL[failureReason]}
                                  <ArrowRight className="h-3 w-3" />
                                </button>
                              </div>
                            )}
                          </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── Mains Questions ──────────────────────────────── */}
        {showMains && data.mainsQuestions.length > 0 && (
          <div className="rounded-lg border border-border/40">
            <button
              onClick={() => toggle("mains")}
              className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/30 transition-colors"
            >
              <span className="flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 text-violet-500" />
                Mains Questions
              </span>
              {expandedSection === "mains" ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>

            {expandedSection === "mains" && (
              <div className="space-y-4 border-t px-4 py-3">
                {data.mainsQuestions.map((q, idx) => (
                  <div key={idx} className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium leading-relaxed">{q.question}</p>
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {q.estimatedMarks}m
                      </Badge>
                    </div>
                    <div className="rounded-md bg-muted/30 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                        Guidance Points
                      </p>
                      <ul className="space-y-0.5">
                        {q.guidancePoints.map((gp, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/40" />
                            {gp}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── Interview Prompts ─────────────────────────────── */}
        {showInterview && data.interviewPrompts.length > 0 && (
          <div className="rounded-lg border border-border/40">
            <button
              onClick={() => toggle("interview")}
              className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/30 transition-colors"
            >
              <span className="flex items-center gap-2">
                <Mic className="h-3.5 w-3.5 text-amber-500" />
                Interview Prompts
              </span>
              {expandedSection === "interview" ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>

            {expandedSection === "interview" && (
              <div className="space-y-3 border-t px-4 py-3">
                {data.interviewPrompts.map((p, idx) => (
                  <div key={idx} className="space-y-1.5">
                    <p className="text-sm font-medium italic leading-relaxed">"{p.prompt}"</p>
                    <div className="flex flex-wrap gap-1">
                      {p.expectedDimensions.map((dim, i) => (
                        <span
                          key={i}
                          className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
                        >
                          {dim}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
