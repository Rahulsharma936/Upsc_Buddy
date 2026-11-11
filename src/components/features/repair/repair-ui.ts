/**
 * Shared repair UI vocabulary — types, labels and block builders.
 *
 * Extracted so the Revision Session (and any future surface) renders repairs
 * identically to Practice without a third copy of these definitions.
 * PracticeCard.tsx and RevisionList.tsx still carry their own inline copies;
 * migrating them here is a follow-up refactor, not a behaviour change.
 *
 * Client-safe: types and constants only. Nothing here imports server modules.
 */

import {
  Lightbulb,
  Brain,
  Search,
  Scale,
  Target,
  AlertTriangle,
  Compass,
} from "lucide-react";

// ─── Student-facing choices ─────────────────────────────────

/** Asked after a CORRECT answer. */
export const POST_OUTCOME_CONFIDENCE = [
  { value: 1, label: "It was a guess" },
  { value: 2, label: "Somewhat confident" },
  { value: 3, label: "Confident" },
] as const;

/** Asked after a WRONG answer. The student's pick is authoritative. */
export const FAILURE_REASONS = [
  { value: "concept_not_understood", label: "I did not understand the concept" },
  { value: "could_not_recall", label: "I knew it but could not recall it" },
  { value: "misunderstood_question", label: "I misread the question or options" },
  { value: "guessed", label: "I was unsure and guessed" },
  { value: "overconfident", label: "I was confident but wrong" },
  { value: "careless_mistake", label: "Careless error" },
  { value: "not_sure", label: "Not sure what went wrong" },
] as const;

export type FailureReasonValue = (typeof FAILURE_REASONS)[number]["value"];

/** Asked after the repair's verification question has been revealed. */
export const POST_REPAIR_UNDERSTANDING = [
  { value: "understood", label: "Clear now" },
  { value: "somewhat_unsure", label: "Partly clear" },
  { value: "still_not_understood", label: "Still unclear" },
] as const;

/** The repair CTA states what the repair will do, in plain terms. */
export const REPAIR_CTA_LABEL: Record<string, string> = {
  concept_not_understood: "Work through the concept",
  could_not_recall: "Recall drill",
  misunderstood_question: "Break down the question",
  guessed: "Resolve the uncertainty",
  overconfident: "Check where the reasoning failed",
  careless_mistake: "Review the error",
  not_sure: "Diagnose the mistake",
};

// ─── Repair payload types (mirror /api/repair responses) ────

export interface RepairVerification {
  question: string;
  options: { a: string; b: string; c: string; d: string };
  correctAnswer: string;
  explanation: string;
  /** Set when the check question came from the student's audited question bank. */
  questionId?: string | null;
  /** Where the check question came from. */
  source?: { kind: "bank" | "related" | "generated"; conceptName?: string };
}

/** Short label for where a check question came from. */
export function checkSourceLabel(v: RepairVerification): string | null {
  if (v.source?.kind === "bank") return "from your question bank";
  if (v.source?.kind === "related") return v.source.conceptName ? `related topic: ${v.source.conceptName}` : "related topic";
  return null;
}

interface RepairCommon {
  requestId: string;
  conceptId: string;
  failureReason: string;
  verification: RepairVerification;
}

export interface ConceptTeachingRepairData extends RepairCommon {
  repairIntent: "concept_teaching";
  explanation: {
    coreIdea: string;
    whyItMatters: string;
    example: string | null;
    keyDistinction: string | null;
  };
}

export interface ActiveRecallRepairData extends RepairCommon {
  repairIntent: "active_recall";
  retrieval: { prompt: string; cue: string | null };
  reveal: { expectedAnswer: string; feedback: string };
}

export interface QuestionInterpretationRepairData extends RepairCommon {
  repairIntent: "question_interpretation";
  breakdown: {
    whatItAsked: string;
    decisiveWording: string;
    whyYourAnswerMissed: string | null;
    whatToLookFor: string;
  };
}

export interface UncertaintyResolutionRepairData extends RepairCommon {
  repairIntent: "uncertainty_resolution";
  breakdown: {
    keyDistinction: string;
    whyBetterSupported: string;
    competingOption: string | null;
    howToDecide: string;
  };
}

export interface CalibrationRepairData extends RepairCommon {
  repairIntent: "calibration";
  breakdown: {
    whatYouBelieved: string;
    whatWasActuallyCorrect: string;
    whereConfidenceBroke: string | null;
    selfCheck: string;
  };
}

export interface ErrorAwarenessRepairData extends RepairCommon {
  repairIntent: "error_awareness";
  breakdown: {
    whatWasOverlooked: string;
    theTrap: string;
    checkingStep: string | null;
    patternAwareness: string;
  };
}

/** No verification: the student has not identified their failure mode yet. */
export interface ClarificationRepairData {
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

export type RepairData =
  | ConceptTeachingRepairData
  | ActiveRecallRepairData
  | QuestionInterpretationRepairData
  | UncertaintyResolutionRepairData
  | CalibrationRepairData
  | ErrorAwarenessRepairData
  | ClarificationRepairData;

// ─── Presentation ───────────────────────────────────────────

export const REPAIR_MODES = {
  concept_teaching: { icon: Lightbulb, title: "Concept review" },
  active_recall: { icon: Brain, title: "Recall drill" },
  question_interpretation: { icon: Search, title: "Question analysis" },
  uncertainty_resolution: { icon: Scale, title: "Option discrimination" },
  calibration: { icon: Target, title: "Reasoning check" },
  error_awareness: { icon: AlertTriangle, title: "Error review" },
  clarification: { icon: Compass, title: "Diagnosis" },
} as const;

export interface RepairBlock {
  label: string;
  text: string;
  italic?: boolean;
}

/** The labelled blocks a repair renders, per intent (post-reveal for active recall). */
export function repairBlocks(repair: RepairData): RepairBlock[] {
  switch (repair.repairIntent) {
    case "concept_teaching":
      return [
        { label: "Core Idea", text: repair.explanation.coreIdea },
        { label: "Why It Matters", text: repair.explanation.whyItMatters },
        ...(repair.explanation.example ? [{ label: "Example", text: repair.explanation.example, italic: true }] : []),
        ...(repair.explanation.keyDistinction ? [{ label: "Key Distinction", text: repair.explanation.keyDistinction }] : []),
      ];
    case "active_recall":
      // Only the model answer. The executor's pre-written "feedback" was
      // generated before the student answered, so it cannot judge them;
      // their written answer is marked separately by /api/answer/evaluate.
      return [{ label: "Model answer", text: repair.reveal.expectedAnswer }];
    case "question_interpretation":
      return [
        { label: "What It Asked", text: repair.breakdown.whatItAsked },
        { label: "The Wording That Decided It", text: repair.breakdown.decisiveWording },
        ...(repair.breakdown.whyYourAnswerMissed ? [{ label: "Why Your Answer Missed", text: repair.breakdown.whyYourAnswerMissed }] : []),
        { label: "What To Look For Next Time", text: repair.breakdown.whatToLookFor },
      ];
    case "uncertainty_resolution":
      return [
        { label: "Key Distinction", text: repair.breakdown.keyDistinction },
        { label: "Why It's Better Supported", text: repair.breakdown.whyBetterSupported },
        ...(repair.breakdown.competingOption ? [{ label: "The Tempting Option", text: repair.breakdown.competingOption }] : []),
        { label: "How To Decide Next Time", text: repair.breakdown.howToDecide },
      ];
    case "calibration":
      return [
        { label: "What You Believed", text: repair.breakdown.whatYouBelieved },
        { label: "What Was Actually Correct", text: repair.breakdown.whatWasActuallyCorrect },
        ...(repair.breakdown.whereConfidenceBroke ? [{ label: "Where Confidence Broke", text: repair.breakdown.whereConfidenceBroke }] : []),
        { label: "Self-Check For Next Time", text: repair.breakdown.selfCheck },
      ];
    case "error_awareness":
      return [
        { label: "What Was Overlooked", text: repair.breakdown.whatWasOverlooked },
        { label: "The Trap", text: repair.breakdown.theTrap },
        ...(repair.breakdown.checkingStep ? [{ label: "Checking Step", text: repair.breakdown.checkingStep }] : []),
        { label: "Pattern To Watch For", text: repair.breakdown.patternAwareness },
      ];
    case "clarification":
      return [
        { label: "What The Question Needed", text: repair.breakdown.whatTheQuestionNeeded },
        ...repair.breakdown.possibleStumblingPoints.map((point, i) => ({ label: `Possible Stumbling Point ${i + 1}`, text: point })),
        ...(repair.breakdown.howToNarrowItDown ? [{ label: "How To Narrow It Down", text: repair.breakdown.howToNarrowItDown }] : []),
        { label: "Strategy For Next Time", text: repair.breakdown.nextTimeStrategy },
      ];
  }
}
