"use client";

/**
 * SUPERSEDED (2026-11-11): no longer rendered on /dashboard/revision.
 * Its recall-then-reveal self-assessment ("Remembered / Partially / Forgot")
 * measured recognition, not recall. Replaced by RevisionSession (questions,
 * and deterministic cloze checks for concepts without questions) plus the
 * read-only DueConceptsList. Kept for reference until its repair-UI copy is
 * migrated to RepairFlow.
 */

/**
 * RevisionList — Retrieval-first spaced repetition surface.
 *
 * R1.3 workflow:
 * 1. Show concept name + subject as recall cue (NOT full material)
 * 2. Student attempts mental recall
 * 3. Student clicks "Reveal Material" to see notes
 * 4. Student self-assesses: Remembered / Partially / Forgot / Skip
 * 5. API call → SM-2 + mastery update → next concept
 *
 * Self-assessment mapping:
 *   Remembered → quality 4, Partially → quality 3, Forgot → quality 1
 * Raw selfAssessment stored in eventMetadata separately from derived quality.
 *
 * Calm, academically useful. No urgency or manipulation.
 */

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn } from "@/lib/utils";
import {
  RotateCcw,
  Brain,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  Loader2,
  Zap,
  Eye,
  SkipForward,
  BookOpen,
  ArrowRight,
  Lightbulb,
  Scale,
  Search,
  Target,
  Compass,
  XCircle,
} from "lucide-react";
import {
  decideNextAction,
  applyReofferLimit,
  MAX_ADDITIONAL_REPAIR_OFFERS,
} from "@/lib/repair/repair-next-action";
import { ReinforcementPanel } from "@/components/features/reinforcement/ReinforcementPanel";
import type { RepairNextAction } from "@/lib/repair/repair-next-action";
import type { PostRepairUnderstanding } from "@/lib/evidence/evidence.types";

interface RevisionItem {
  conceptId: string;
  conceptName: string;
  subject: string;
  masteryLevel: string;
  priorityScore: number;
  forgettingProbability: number;
  isWeakArea: boolean;
  daysSinceReview: number | null;
  daysOverdue: number;
  intervalDays: number;
}

interface RevisionStats {
  totalConcepts: number;
  mastered: number;
  reviewing: number;
  learning: number;
  unseen: number;
  weakAreas: number;
  dueNow: number;
  averageConfidence: number;
}

// Note material fetched on-demand for the active revision concept
interface ConceptNote {
  coreIdea: string;
  examTriggers: string[];
  memoryHooks: string[];
  answerWritingAngles: string[];
}

// Self-assessment options — raw label → SM-2 quality mapping
const SELF_ASSESSMENT_OPTIONS = [
  { value: "remembered" as const, label: "Remembered", quality: 4, color: "bg-green-600 hover:bg-green-700 text-white", icon: "✓" },
  { value: "partially" as const, label: "Partially", quality: 3, color: "bg-amber-500 hover:bg-amber-600 text-white", icon: "◐" },
  { value: "forgot" as const, label: "Forgot", quality: 1, color: "bg-red-500 hover:bg-red-600 text-white", icon: "✗" },
] as const;

const MASTERY_CONFIG: Record<string, { label: string; color: string; icon: typeof Brain }> = {
  mastered: { label: "Mastered", color: "text-green-600 bg-green-500/10", icon: CheckCircle2 },
  reviewing: { label: "Reviewing", color: "text-blue-600 bg-blue-500/10", icon: RotateCcw },
  learning: { label: "Learning", color: "text-amber-600 bg-amber-500/10", icon: Brain },
  unseen: { label: "Unseen", color: "text-muted-foreground bg-muted", icon: Clock },
};

// ─── Repair types (inline — avoids importing server-only modules) ──

interface RepairVerification {
  question: string;
  options: { a: string; b: string; c: string; d: string };
  correctAnswer: string;
  explanation: string;
}

interface RepairRetrieval {
  prompt: string;
  cue: string | null;
}

interface RepairReveal {
  expectedAnswer: string;
  feedback: string;
}

interface RepairExplanation {
  coreIdea: string;
  whyItMatters: string;
  example: string | null;
  keyDistinction: string | null;
}

interface RepairCommon {
  requestId: string;
  conceptId: string;
  failureReason: string;
  verification: RepairVerification;
}

interface ConceptTeachingRepairData extends RepairCommon {
  repairIntent: "concept_teaching";
  explanation: RepairExplanation;
}

interface ActiveRecallRepairData extends RepairCommon {
  repairIntent: "active_recall";
  retrieval: RepairRetrieval;
  reveal: RepairReveal;
}

interface QuestionInterpretationRepairData extends RepairCommon {
  repairIntent: "question_interpretation";
  breakdown: {
    whatItAsked: string;
    decisiveWording: string;
    whyYourAnswerMissed: string | null;
    whatToLookFor: string;
  };
}

interface UncertaintyResolutionRepairData extends RepairCommon {
  repairIntent: "uncertainty_resolution";
  breakdown: {
    keyDistinction: string;
    whyBetterSupported: string;
    competingOption: string | null;
    howToDecide: string;
  };
}

interface CalibrationRepairData extends RepairCommon {
  repairIntent: "calibration";
  breakdown: {
    whatYouBelieved: string;
    whatWasActuallyCorrect: string;
    whereConfidenceBroke: string | null;
    selfCheck: string;
  };
}

interface ErrorAwarenessRepairData extends RepairCommon {
  repairIntent: "error_awareness";
  breakdown: {
    whatWasOverlooked: string;
    theTrap: string;
    checkingStep: string | null;
    patternAwareness: string;
  };
}

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

type RevisionRepairData =
  | ConceptTeachingRepairData
  | ActiveRecallRepairData
  | QuestionInterpretationRepairData
  | UncertaintyResolutionRepairData
  | CalibrationRepairData
  | ErrorAwarenessRepairData
  | ClarificationRepairData;

/** Header shown at the top of the repair card, per repair mode. */
const REPAIR_MODES: Record<string, { icon: typeof Brain; title: string }> = {
  concept_teaching: { icon: Lightbulb, title: "Targeted Explanation" },
  active_recall: { icon: Brain, title: "Try to Recall This" },
  question_interpretation: { icon: Search, title: "What This Question Asked" },
  uncertainty_resolution: { icon: Scale, title: "How To Choose Confidently" },
  calibration: { icon: Target, title: "Confidence Check" },
  error_awareness: { icon: AlertTriangle, title: "What Was Overlooked" },
  clarification: { icon: Compass, title: "Finding What Went Wrong" },
};

/** One labelled block inside the repair card. */
interface RepairBlock {
  label: string;
  text: string;
  italic?: boolean;
}

function revisionRepairBlocks(repair: RevisionRepairData): RepairBlock[] {
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

/** Renders one labelled block. Same markup used in PracticeCard. */
function RevisionRepairFieldBlock({ label, text, italic }: RepairBlock) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-600/70 dark:text-blue-400/70 mb-0.5">{label}</p>
      <p className={cn("text-xs leading-relaxed text-foreground", italic && "italic")}>{text}</p>
    </div>
  );
}

// ─── Post-repair self-assessment (R3.3) ─────────────────────

const POST_REPAIR_UNDERSTANDING = [
  { value: "understood", label: "I understand it", emoji: "💡" },
  { value: "somewhat_unsure", label: "I\u2019m somewhat unsure", emoji: "🤔" },
  { value: "still_not_understood", label: "I still don\u2019t understand it", emoji: "❓" },
] as const;

// ─── Revision repair: failure reason mapping ─────────────────
// When a student marks "Forgot" or "Partially" in revision,
// we offer a repair CTA. The repair uses "could_not_recall" for
// "Forgot" (most appropriate — they couldn't retrieve it) and
// lets the student pick for "Partially".

const REVISION_REPAIR_CTA: Record<string, { label: string; failureReason: string }> = {
  forgot: { label: "Help me re-learn this concept", failureReason: "concept_not_understood" },
  partially: { label: "Help me recall this better", failureReason: "could_not_recall" },
};


export function RevisionList() {
  const [recommendations, setRecommendations] = useState<RevisionItem[]>([]);
  const [stats, setStats] = useState<RevisionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [conceptCount, setConceptCount] = useState(0);
  const [backfilling, setBackfilling] = useState(false);

  // R1.3: Active revision state
  const [activeConceptId, setActiveConceptId] = useState<string | null>(null);
  const [materialRevealed, setMaterialRevealed] = useState(false);
  const [conceptNote, setConceptNote] = useState<ConceptNote | null>(null);
  const [loadingNote, setLoadingNote] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Track completed concepts to show feedback briefly
  const [completedConcepts, setCompletedConcepts] = useState<
    Record<string, { assessment: string; intervalDays?: number }>
  >({});

  // ─── Repair state (keyed by conceptId) ──────────────────
  const [repairOffered, setRepairOffered] = useState<Record<string, string>>({});
  const [repairLoading, setRepairLoading] = useState<Record<string, boolean>>({});
  const [repairData, setRepairData] = useState<Record<string, RevisionRepairData>>({});
  const [repairError, setRepairError] = useState<Record<string, string>>({});
  // Verification answer state within the repair
  const [verificationAnswer, setVerificationAnswer] = useState<Record<string, string>>({});
  const [verificationRevealed, setVerificationRevealed] = useState<Record<string, boolean>>({});
  const [verificationSaving, setVerificationSaving] = useState<Record<string, boolean>>({});
  const [verificationSaveFailed, setVerificationSaveFailed] = useState<Record<string, boolean>>({});
  // R3.5: recall reveal for active_recall repairs
  const [recallRevealed, setRecallRevealed] = useState<Record<string, boolean>>({});
  // R3.3: Post-repair self-assessment
  const [understandingAnswer, setUnderstandingAnswer] = useState<Record<string, string>>({});
  const [understandingSaving, setUnderstandingSaving] = useState<Record<string, boolean>>({});
  const [understandingSaveFailed, setUnderstandingSaveFailed] = useState<Record<string, boolean>>({});
  // R3.4: Next action
  const [nextAction, setNextAction] = useState<Record<string, RepairNextAction>>({});
  const [reoffersUsed, setReoffersUsed] = useState<Record<string, number>>({});

  /** Drop one key from a per-concept state map. */
  const clearKey = <T,>(prev: Record<string, T>, key: string): Record<string, T> => {
    const next = { ...prev };
    delete next[key];
    return next;
  };

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [recRes, statsRes, notesRes] = await Promise.all([
        fetch("/api/revision?action=recommendations"),
        fetch("/api/revision?action=stats"),
        fetch("/api/notes"),
      ]);

      const recJson = await recRes.json();
      const statsJson = await statsRes.json();
      const notesJson = await notesRes.json();

      if (recJson.success) setRecommendations(recJson.data?.recommendations ?? []);
      if (statsJson.success) setStats(statsJson.data?.stats ?? null);
      if (notesJson.success) setConceptCount(notesJson.data?.summary?.totalConcepts ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load revision data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleBackfill = async () => {
    setBackfilling(true);
    try {
      await fetch("/api/ai/hydrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 20, layers: ["revision"] }),
      });
      await fetchData();
    } catch {
      // Silent
    } finally {
      setBackfilling(false);
    }
  };

  // R1.3: Activate a concept for revision — show recall cue
  const handleStartRevision = (conceptId: string) => {
    setActiveConceptId(conceptId);
    setMaterialRevealed(false);
    setConceptNote(null);
  };

  // R1.3: Reveal material — fetch note data for the concept
  const handleRevealMaterial = async (conceptId: string) => {
    setLoadingNote(true);
    try {
      const res = await fetch(`/api/notes?conceptId=${encodeURIComponent(conceptId)}`);
      const json = await res.json();
      if (json.success) {
        const items = json.data?.items ?? [];
        const match = items.find(
          (item: { concept: { id: string } }) => item.concept.id === conceptId
        );
        if (match?.note) {
          setConceptNote({
            coreIdea: match.note.coreIdea || "",
            examTriggers: match.note.examTriggers || [],
            memoryHooks: match.note.memoryHooks || [],
            answerWritingAngles: match.note.answerWritingAngles || [],
          });
        } else {
          // No note available — still allow self-assessment
          setConceptNote({
            coreIdea: "No study notes generated for this concept yet.",
            examTriggers: [],
            memoryHooks: [],
            answerWritingAngles: [],
          });
        }
      }
    } catch {
      setConceptNote({
        coreIdea: "Could not load notes. You can still self-assess.",
        examTriggers: [],
        memoryHooks: [],
        answerWritingAngles: [],
      });
    } finally {
      setLoadingNote(false);
      setMaterialRevealed(true);
    }
  };

  // R1.3: Handle self-assessment — call existing revision API
  // For "forgot" and "partially", we keep the concept active to offer a repair.
  const handleSelfAssess = async (
    conceptId: string,
    assessment: "remembered" | "partially" | "forgot",
    quality: number
  ) => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/revision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conceptId,
          action: "self_assessment",
          quality,
          // R1.3: Raw self-assessment evidence — stored in eventMetadata,
          // separate from the derived SM-2 quality above
          selfAssessment: assessment,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        console.warn("[Revision] Self-assessment failed:", res.status);
      }

      // "Remembered" → standard flow: show feedback, remove from list.
      // "Forgot"/"Partially" → keep active, offer repair CTA.
      if (assessment === "remembered") {
        setCompletedConcepts((prev) => ({
          ...prev,
          [conceptId]: {
            assessment,
            intervalDays: json.data?.intervalDays,
          },
        }));

        setActiveConceptId(null);
        setMaterialRevealed(false);
        setConceptNote(null);

        setTimeout(() => {
          setRecommendations((prev) => prev.filter((r) => r.conceptId !== conceptId));
          setCompletedConcepts((prev) => {
            const next = { ...prev };
            delete next[conceptId];
            return next;
          });
          fetch("/api/revision?action=stats")
            .then((r) => r.json())
            .then((j) => {
              if (j.success) setStats(j.data?.stats ?? null);
            })
            .catch(() => {});
        }, 1200);
      } else {
        // "forgot" or "partially" — keep the card active and offer a repair CTA.
        // SM-2 has already been updated above; this only affects the UI.
        const ctaConfig = REVISION_REPAIR_CTA[assessment];
        if (ctaConfig) {
          setRepairOffered((prev) => ({ ...prev, [conceptId]: assessment }));
        }
      }
    } catch (err) {
      console.warn("[Revision] Self-assessment error:", err);
    } finally {
      setSubmitting(false);
    }
  };

  // R1.3: Handle skip — existing skip infrastructure
  const handleSkip = async (conceptId: string) => {
    setSubmitting(true);
    try {
      await fetch("/api/revision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conceptId,
          action: "skip",
        }),
      });

      // Show brief feedback
      setCompletedConcepts((prev) => ({
        ...prev,
        [conceptId]: { assessment: "skipped" },
      }));

      setActiveConceptId(null);
      setMaterialRevealed(false);
      setConceptNote(null);

      setTimeout(() => {
        setRecommendations((prev) => prev.filter((r) => r.conceptId !== conceptId));
        setCompletedConcepts((prev) => {
          const next = { ...prev };
          delete next[conceptId];
          return next;
        });
      }, 800);
    } catch (err) {
      console.warn("[Revision] Skip error:", err);
    } finally {
      setSubmitting(false);
    }
  };

  // Cancel active revision — go back to list
  const handleCancelRevision = () => {
    setActiveConceptId(null);
    setMaterialRevealed(false);
    setConceptNote(null);
  };

  // ─── Repair handlers (keyed by conceptId) ─────────────────

  /**
   * R3.2a: Fetch a repair for a revision concept the student struggled with.
   *
   * Uses the mapped failure reason from REVISION_REPAIR_CTA rather than
   * asking the student "what went wrong?" — in revision, the self-assessment
   * already tells us enough (Forgot → concept_not_understood, Partially →
   * could_not_recall).
   */
  const handleRequestRevisionRepair = (conceptId: string) => {
    const assessment = repairOffered[conceptId];
    if (!assessment) return;

    const ctaConfig = REVISION_REPAIR_CTA[assessment];
    if (!ctaConfig) return;

    setRepairLoading((prev) => ({ ...prev, [conceptId]: true }));
    setRepairError((prev) => ({ ...prev, [conceptId]: "" }));

    fetch("/api/repair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conceptId,
        failureReason: ctaConfig.failureReason,
        // No questionContext — revision repairs are concept-level, not MCQ-level.
      }),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error?.message || "Repair request failed");
        }
        setRepairData((prev) => ({ ...prev, [conceptId]: json.data.repair }));
      })
      .catch((err) => {
        setRepairError((prev) => ({
          ...prev,
          [conceptId]: err.message || "Something went wrong",
        }));
      })
      .finally(() => {
        setRepairLoading((prev) => ({ ...prev, [conceptId]: false }));
      });
  };

  /**
   * R3.3: Student answers the post-repair verification MCQ.
   *
   * Grades locally, then persists as a repair_verification event.
   * Does NOT touch SM-2.
   */
  const handleRevisionVerificationSelect = (conceptId: string, opt: string) => {
    const repair = repairData[conceptId];
    if (!repair) return;

    // Duplicate guard
    if (verificationAnswer[conceptId] || verificationSaving[conceptId]) return;

    setVerificationAnswer((prev) => ({ ...prev, [conceptId]: opt }));
    setVerificationRevealed((prev) => ({ ...prev, [conceptId]: true }));
    setVerificationSaving((prev) => ({ ...prev, [conceptId]: true }));
    setVerificationSaveFailed((prev) => ({ ...prev, [conceptId]: false }));

    fetch("/api/repair/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: repair.requestId,
        conceptId: repair.conceptId,
        failureReason: repair.failureReason,
        repairIntent: repair.repairIntent,
        verificationSelectedAnswer: opt,
        verificationCorrectAnswer: repair.verification!.correctAnswer,
        verificationQuestion: repair.verification!.question,
      }),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          throw new Error(json?.error?.message || "Verification save failed");
        }
      })
      .catch((err) => {
        console.warn("[Revision] Repair verification save failed:", err);
        setVerificationSaveFailed((prev) => ({ ...prev, [conceptId]: true }));
      })
      .finally(() => {
        setVerificationSaving((prev) => ({ ...prev, [conceptId]: false }));
      });
  };

  /**
   * R3.3: Student reports understanding after repair.
   *
   * Also derives the R3.4 next-action locally, gated by the re-offer budget.
   */
  const handleRevisionUnderstandingSelect = (
    conceptId: string,
    value: PostRepairUnderstanding,
  ) => {
    const repair = repairData[conceptId];
    if (!repair) return;

    if (understandingAnswer[conceptId] || understandingSaving[conceptId]) return;

    setUnderstandingAnswer((prev) => ({ ...prev, [conceptId]: value }));
    setUnderstandingSaving((prev) => ({ ...prev, [conceptId]: true }));
    setUnderstandingSaveFailed((prev) => ({ ...prev, [conceptId]: false }));

    // R3.4: decide next action
    setNextAction((prev) => ({
      ...prev,
      [conceptId]: applyReofferLimit(
        decideNextAction({
          verificationCorrect:
            verificationAnswer[conceptId] === repair.verification!.correctAnswer,
          postRepairUnderstanding: value,
        }),
        reoffersUsed[conceptId] ?? 0,
      ),
    }));

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
        console.warn("[Revision] Post-repair understanding save failed:", err);
        setUnderstandingSaveFailed((prev) => ({ ...prev, [conceptId]: true }));
      })
      .finally(() => {
        setUnderstandingSaving((prev) => ({ ...prev, [conceptId]: false }));
      });
  };

  /**
   * R3.4: Serve one extra repair for this concept.
   *
   * Clears the previous repair loop so the fresh one starts clean,
   * then reuses handleRequestRevisionRepair.
   */
  const handleRevisionAnotherRepair = (conceptId: string) => {
    if ((reoffersUsed[conceptId] ?? 0) >= MAX_ADDITIONAL_REPAIR_OFFERS) return;
    if (repairLoading[conceptId]) return;

    setReoffersUsed((prev) => ({ ...prev, [conceptId]: (prev[conceptId] ?? 0) + 1 }));

    setRepairData((prev) => clearKey(prev, conceptId));
    setVerificationAnswer((prev) => clearKey(prev, conceptId));
    setVerificationRevealed((prev) => clearKey(prev, conceptId));
    setRecallRevealed((prev) => clearKey(prev, conceptId));
    setVerificationSaveFailed((prev) => clearKey(prev, conceptId));
    setUnderstandingAnswer((prev) => clearKey(prev, conceptId));
    setUnderstandingSaveFailed((prev) => clearKey(prev, conceptId));
    setNextAction((prev) => clearKey(prev, conceptId));

    handleRequestRevisionRepair(conceptId);
  };

  /**
   * Dismiss the repair offer and remove the concept from the list.
   * The SM-2 update was already done during self-assessment.
   */
  const handleDismissRepair = (conceptId: string) => {
    // Clean up all repair state for this concept
    setRepairOffered((prev) => clearKey(prev, conceptId));
    setRepairData((prev) => clearKey(prev, conceptId));
    setRepairLoading((prev) => clearKey(prev, conceptId));
    setRepairError((prev) => clearKey(prev, conceptId));
    setVerificationAnswer((prev) => clearKey(prev, conceptId));
    setVerificationRevealed((prev) => clearKey(prev, conceptId));
    setVerificationSaveFailed((prev) => clearKey(prev, conceptId));
    setRecallRevealed((prev) => clearKey(prev, conceptId));
    setUnderstandingAnswer((prev) => clearKey(prev, conceptId));
    setUnderstandingSaveFailed((prev) => clearKey(prev, conceptId));
    setNextAction((prev) => clearKey(prev, conceptId));
    setReoffersUsed((prev) => clearKey(prev, conceptId));

    setActiveConceptId(null);
    setMaterialRevealed(false);
    setConceptNote(null);

    // Remove from list
    setRecommendations((prev) => prev.filter((r) => r.conceptId !== conceptId));
    // Refresh stats
    fetch("/api/revision?action=stats")
      .then((r) => r.json())
      .then((j) => {
        if (j.success) setStats(j.data?.stats ?? null);
      })
      .catch(() => {});
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <LoadingSpinner />
        <p className="text-sm text-muted-foreground">Loading revision schedule…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <button onClick={fetchData} className="mt-3 text-sm font-medium text-primary hover:underline">
          Try again
        </button>
      </div>
    );
  }

  // Hydration state: concepts exist but revision not initialized
  if (stats && stats.totalConcepts === 0 && conceptCount > 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="rounded-full bg-amber-500/10 p-4">
          <RotateCcw className="h-8 w-8 text-amber-500" />
        </div>
        <div className="text-center space-y-1.5">
          <h3 className="text-base font-semibold">Revision not yet initialized</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            You have {conceptCount} concept{conceptCount !== 1 ? "s" : ""} but revision scheduling hasn't been set up yet. Initialize now to start spaced repetition.
          </p>
        </div>
        <Button
          onClick={handleBackfill}
          disabled={backfilling}
          className="gap-2"
          size="sm"
        >
          {backfilling ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Initializing revision…
            </>
          ) : (
            <>
              <Zap className="h-4 w-4" />
              Initialize Revision
            </>
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ─── Stats Summary (collapsible) ────────────────────── */}
      {stats && (
        <Card className="border-border/60">
          <button
            onClick={() => setShowStats(!showStats)}
            className="flex w-full items-center justify-between px-5 py-3"
          >
            <div className="flex items-center gap-4 text-sm">
              <span>
                <span className="font-semibold text-foreground">{stats.dueNow}</span>
                <span className="text-muted-foreground"> due now</span>
              </span>
              <span className="text-border">|</span>
              <span>
                <span className="font-semibold text-green-600 dark:text-green-400">{stats.mastered}</span>
                <span className="text-muted-foreground"> mastered</span>
              </span>
              <span className="text-border">|</span>
              <span>
                <span className="font-semibold text-amber-600 dark:text-amber-400">{stats.weakAreas}</span>
                <span className="text-muted-foreground"> weak</span>
              </span>
            </div>
            {showStats ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>

          {showStats && (
            <CardContent className="border-t pt-3 pb-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Mastered", value: stats.mastered, color: "text-green-600" },
                  { label: "Reviewing", value: stats.reviewing, color: "text-blue-600" },
                  { label: "Learning", value: stats.learning, color: "text-amber-600" },
                  { label: "Unseen", value: stats.unseen, color: "text-muted-foreground" },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg bg-muted/30 px-3 py-2 text-center">
                    <p className={cn("text-xl font-bold", s.color)}>{s.value}</p>
                    <p className="text-[10px] text-muted-foreground">{s.label}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <span>Avg. confidence:</span>
                <span className="font-medium text-foreground">{Math.round(stats.averageConfidence * 100)}%</span>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* ─── Due Concepts ───────────────────────────────────── */}
      {recommendations.length === 0 ? (
        <EmptyState
          icon={<RotateCcw className="h-6 w-6" />}
          title="Nothing due for revision"
          description="All concepts are on schedule. New revision items will surface as intervals expire."
        />
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground px-1">
            {recommendations.length} concept{recommendations.length !== 1 ? "s" : ""} ready for revision
          </p>
          <div className="space-y-2">
            {recommendations.map((item) => {
              const config = MASTERY_CONFIG[item.masteryLevel] ?? MASTERY_CONFIG.unseen;
              const Icon = config.icon;
              const isActive = activeConceptId === item.conceptId;
              const completed = completedConcepts[item.conceptId];

              // ─── Completed feedback state ───────────────
              if (completed) {
                const feedbackColor =
                  completed.assessment === "remembered" ? "border-green-500/50 bg-green-50/50 dark:bg-green-500/5" :
                  completed.assessment === "partially" ? "border-amber-500/50 bg-amber-50/50 dark:bg-amber-500/5" :
                  completed.assessment === "forgot" ? "border-red-500/50 bg-red-50/50 dark:bg-red-500/5" :
                  "border-muted bg-muted/30";
                const feedbackLabel =
                  completed.assessment === "skipped" ? "Skipped" :
                  completed.assessment.charAt(0).toUpperCase() + completed.assessment.slice(1);

                return (
                  <Card key={item.conceptId} className={cn("border transition-all duration-500 opacity-60", feedbackColor)}>
                    <CardContent className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">{item.conceptName}</span>
                      </div>
                      <span className="text-xs font-medium text-muted-foreground">
                        {feedbackLabel}
                        {completed.intervalDays != null && ` · Next in ${completed.intervalDays}d`}
                      </span>
                    </CardContent>
                  </Card>
                );
              }

              // ─── Active revision card ───────────────────
              if (isActive) {
                return (
                  <Card key={item.conceptId} className="border-border/50 border-l-2 border-l-blue-500 shadow-sm">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className={cn("rounded-md p-1.5", config.color)}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div>
                            <h3 className="text-sm font-semibold">{item.conceptName}</h3>
                            <div className="flex items-center gap-2 mt-0.5">
                              <Badge variant="secondary" className="text-[10px] h-4">
                                {item.subject}
                              </Badge>
                              {item.isWeakArea && (
                                <AlertTriangle className="h-3 w-3 text-amber-500" />
                              )}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={handleCancelRevision}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          ← Back
                        </button>
                      </div>
                    </CardHeader>

                    <CardContent className="pt-0 space-y-3">
                      {/* Step 1: Recall cue — tell student to try recalling */}
                      {!materialRevealed && (
                        <div className="space-y-3 animate-in fade-in duration-200">
                          <div className="rounded-lg bg-blue-50/60 dark:bg-blue-500/5 border border-blue-200/40 dark:border-blue-500/15 px-4 py-3">
                            <p className="text-sm text-blue-800 dark:text-blue-300 font-medium mb-1">
                              What do you recall about this concept?
                            </p>
                            <p className="text-xs text-blue-600/70 dark:text-blue-400/60">
                              Try to mentally recall the key idea, exam relevance, and any memory hooks before revealing the material.
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              onClick={() => handleRevealMaterial(item.conceptId)}
                              disabled={loadingNote}
                              variant="outline"
                              size="sm"
                              className="gap-1.5 flex-1"
                            >
                              {loadingNote ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Eye className="h-3.5 w-3.5" />
                              )}
                              Reveal Material
                            </Button>
                            <Button
                              onClick={() => handleSkip(item.conceptId)}
                              disabled={submitting}
                              variant="ghost"
                              size="sm"
                              className="gap-1.5 text-muted-foreground"
                            >
                              <SkipForward className="h-3.5 w-3.5" />
                              Skip
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Step 2: Material revealed — show notes + self-assessment */}
                      {materialRevealed && conceptNote && (
                        <div className="space-y-3 animate-in fade-in slide-in-from-top-1 duration-300">
                          {/* Note content */}
                          <div className="rounded-lg border border-border/40 bg-muted/20 px-4 py-3 space-y-2.5">
                            {conceptNote.coreIdea && (
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                                  Core Idea
                                </p>
                                <p className="text-sm leading-relaxed">{conceptNote.coreIdea}</p>
                              </div>
                            )}
                            {conceptNote.examTriggers.length > 0 && (
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                                  Exam Triggers
                                </p>
                                <ul className="space-y-0.5">
                                  {conceptNote.examTriggers.map((t, i) => (
                                    <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/40" />
                                      {t}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {conceptNote.memoryHooks.length > 0 && (
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                                  Memory Hooks
                                </p>
                                <ul className="space-y-0.5">
                                  {conceptNote.memoryHooks.map((h, i) => (
                                    <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-violet-400/40" />
                                      {h}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>

                          {/* Self-assessment buttons — hidden once repair is offered */}
                          {!repairOffered[item.conceptId] && (
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">
                              How well did you recall this?
                            </p>
                            <div className="grid grid-cols-3 gap-2">
                              {SELF_ASSESSMENT_OPTIONS.map((opt) => (
                                <button
                                  key={opt.value}
                                  onClick={() => handleSelfAssess(item.conceptId, opt.value, opt.quality)}
                                  disabled={submitting}
                                  className={cn(
                                    "rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                                    "flex flex-col items-center gap-0.5",
                                    "disabled:opacity-50",
                                    opt.color
                                  )}
                                >
                                  <span className="text-base">{opt.icon}</span>
                                  <span className="text-[11px]">{opt.label}</span>
                                </button>
                              ))}
                            </div>
                            <button
                              onClick={() => handleSkip(item.conceptId)}
                              disabled={submitting}
                              className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
                            >
                              Skip this concept
                            </button>
                          </div>
                          )}

                          {/* ─── Repair CTA + full repair lifecycle ─── */}
                          {repairOffered[item.conceptId] && (() => {
                            const assessment = repairOffered[item.conceptId];
                            const ctaConfig = REVISION_REPAIR_CTA[assessment];
                            const repair = repairData[item.conceptId];

                            return (
                              <div className="space-y-3 animate-in fade-in slide-in-from-top-1 duration-300">
                                {/* Repair CTA button — before repair is loaded */}
                                {!repair && (
                                  <div className="rounded-md border border-amber-200/60 dark:border-amber-500/20 bg-amber-50/50 dark:bg-amber-500/5 px-3 py-2.5">
                                    <button
                                      onClick={() => handleRequestRevisionRepair(item.conceptId)}
                                      disabled={repairLoading[item.conceptId]}
                                      className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 transition-colors disabled:opacity-50"
                                    >
                                      {repairLoading[item.conceptId] ? (
                                        <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating explanation…</>
                                      ) : (
                                        <><BookOpen className="h-3.5 w-3.5" /> {ctaConfig?.label ?? "Help me with this concept"} <ArrowRight className="h-3 w-3" /></>
                                      )}
                                    </button>
                                    {repairError[item.conceptId] && (
                                      <p className="mt-1.5 text-[10px] text-red-600 dark:text-red-400">{repairError[item.conceptId]}</p>
                                    )}
                                    <button
                                      onClick={() => handleDismissRepair(item.conceptId)}
                                      className="mt-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                      Skip — I&apos;ll review it later
                                    </button>
                                  </div>
                                )}

                                {/* ─── Repair card ─── */}
                                {repair && (
                                  <div className="space-y-3 rounded-lg border border-blue-200/60 dark:border-blue-500/20 bg-blue-50/30 dark:bg-blue-500/5 px-4 py-3 animate-in fade-in slide-in-from-top-2 duration-300">
                                    {/* Repair mode header */}
                                    {(() => {
                                      const ModeIcon = REPAIR_MODES[repair.repairIntent].icon;
                                      return (
                                        <div className="flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-300">
                                          <ModeIcon className="h-3.5 w-3.5" />
                                          {REPAIR_MODES[repair.repairIntent].title}
                                        </div>
                                      );
                                    })()}

                                    {/* Repair content blocks */}
                                    {repair.repairIntent === "active_recall" ? (
                                      <>
                                        {/* R3.5: Retrieval first, answer second */}
                                        <div>
                                          <p className="text-xs leading-relaxed text-foreground font-medium">{repair.retrieval.prompt}</p>
                                          {repair.retrieval.cue && (
                                            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                                              <span className="font-medium">Cue:</span> {repair.retrieval.cue}
                                            </p>
                                          )}
                                        </div>

                                        {!recallRevealed[item.conceptId] ? (
                                          <div>
                                            <p className="mb-1.5 text-[11px] text-muted-foreground">
                                              Answer it in your head first — then check yourself.
                                            </p>
                                            <button
                                              onClick={() => setRecallRevealed((prev) => ({ ...prev, [item.conceptId]: true }))}
                                              className="flex items-center gap-2 text-xs font-medium text-blue-700 dark:text-blue-300 hover:text-blue-900 dark:hover:text-blue-100 transition-colors"
                                            >
                                              <ArrowRight className="h-3.5 w-3.5" /> Show me the answer
                                            </button>
                                          </div>
                                        ) : (
                                          <div className="space-y-3 animate-in fade-in duration-200">
                                            {revisionRepairBlocks(repair).map((block) => (
                                              <RevisionRepairFieldBlock key={block.label} {...block} />
                                            ))}
                                          </div>
                                        )}
                                      </>
                                    ) : (
                                      revisionRepairBlocks(repair).map((block) => (
                                        <RevisionRepairFieldBlock key={block.label} {...block} />
                                      ))
                                    )}

                                    {/* Clarification special case — no verification */}
                                    {repair.repairIntent === "clarification" && (
                                      <>
                                        <p className="mt-2.5 flex items-center gap-1.5 text-[11px] font-medium text-blue-700 dark:text-blue-300">
                                          <Compass className="h-3.5 w-3.5 shrink-0" />
                                          Use these pointers to identify what specifically blocked you, then try a similar question.
                                        </p>
                                        {/* Reinforcement: resurface the student's own Knowledge — no verification exists for clarification. */}
                                        <ReinforcementPanel
                                          conceptId={item.conceptId}
                                          failureReason={repair.failureReason}
                                          outcome="clarified"
                                        />
                                      </>
                                    )}

                                    {/* ─── Verification MCQ (R3.3) ─── */}
                                    {repair.verification && (repair.repairIntent !== "active_recall" || recallRevealed[item.conceptId]) && (
                                      <div className="mt-2 rounded-md border border-blue-200/50 dark:border-blue-500/15 bg-white/50 dark:bg-blue-950/20 px-3 py-2.5">
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-600/70 dark:text-blue-400/70 mb-2">Let&apos;s Check</p>
                                        <p className="text-xs font-medium leading-relaxed mb-2">{repair.verification.question}</p>
                                        <div className="grid gap-1.5 sm:grid-cols-2">
                                          {(["a", "b", "c", "d"] as const).map((opt) => {
                                            const vAnswer = verificationAnswer[item.conceptId];
                                            const isRevealed = verificationRevealed[item.conceptId];
                                            const isCorrectOpt = repair.verification!.correctAnswer === opt;
                                            const isSelected = vAnswer === opt;

                                            return (
                                              <button
                                                key={opt}
                                                onClick={() => handleRevisionVerificationSelect(item.conceptId, opt)}
                                                disabled={!!vAnswer}
                                                className={cn(
                                                  "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors",
                                                  isRevealed && isCorrectOpt && "border-green-500/50 bg-green-50 dark:bg-green-500/10",
                                                  isRevealed && isSelected && !isCorrectOpt && "border-red-500/50 bg-red-50 dark:bg-red-500/10",
                                                  !vAnswer && "hover:bg-muted/50 cursor-pointer",
                                                  !!vAnswer && "cursor-default",
                                                )}
                                              >
                                                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold">
                                                  {opt.toUpperCase()}
                                                </span>
                                                <span>{repair.verification!.options[opt]}</span>
                                                {isRevealed && isCorrectOpt && <CheckCircle2 className="ml-auto h-4 w-4 text-green-600 shrink-0" />}
                                                {isRevealed && isSelected && !isCorrectOpt && <XCircle className="ml-auto h-4 w-4 text-red-500 shrink-0" />}
                                              </button>
                                            );
                                          })}
                                        </div>
                                        {verificationRevealed[item.conceptId] && (
                                          <div className="mt-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground leading-relaxed">
                                            <span className="font-medium text-foreground">
                                              {verificationAnswer[item.conceptId] === repair.verification!.correctAnswer ? "✓ Correct! " : "✗ Not quite. "}
                                            </span>
                                            {repair.verification!.explanation}
                                          </div>
                                        )}
                                        {verificationSaveFailed[item.conceptId] && (
                                          <p className="mt-1.5 text-[10px] text-muted-foreground">
                                            Couldn&apos;t save this result — your answer above still stands.
                                          </p>
                                        )}

                                        {/* ─── R3.3: Post-repair self-assessment ─── */}
                                        {verificationRevealed[item.conceptId] && (
                                          <div className="mt-2.5 rounded-md border border-blue-200/60 dark:border-blue-500/20 bg-blue-50/60 dark:bg-blue-500/5 px-3 py-2.5 animate-in fade-in slide-in-from-top-1 duration-300">
                                            <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-2.5">
                                              How confident do you feel about this concept now?
                                            </p>
                                            <div className="space-y-1.5">
                                              {POST_REPAIR_UNDERSTANDING.map((option) => {
                                                const answered = !!understandingAnswer[item.conceptId];
                                                const isSelected = understandingAnswer[item.conceptId] === option.value;

                                                return (
                                                  <button
                                                    key={option.value}
                                                    onClick={() => handleRevisionUnderstandingSelect(item.conceptId, option.value)}
                                                    disabled={answered}
                                                    className={cn(
                                                      "flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors",
                                                      "border-blue-200/60 dark:border-blue-500/20 text-blue-800 dark:text-blue-200",
                                                      !answered && "bg-white dark:bg-blue-950/30 hover:bg-blue-100/80 dark:hover:bg-blue-500/15 cursor-pointer",
                                                      answered && isSelected && "bg-blue-100/80 dark:bg-blue-500/15 border-blue-400/60 dark:border-blue-400/30 cursor-default",
                                                      answered && !isSelected && "bg-white dark:bg-blue-950/30 opacity-50 cursor-default",
                                                    )}
                                                  >
                                                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-blue-300/60 dark:border-blue-500/30 text-sm">
                                                      {option.emoji}
                                                    </span>
                                                    <span>{option.label}</span>
                                                  </button>
                                                );
                                              })}
                                            </div>
                                            {understandingSaveFailed[item.conceptId] && (
                                              <p className="mt-1.5 text-[10px] text-muted-foreground">
                                                Couldn&apos;t save this — your answer above still stands.
                                              </p>
                                            )}
                                          </div>
                                        )}

                                        {/* ─── R3.4: Next action ─── */}
                                        {nextAction[item.conceptId] === "repair_complete" && (
                                          <div className="mt-2.5">
                                            <p className="flex items-center gap-1.5 text-[11px] font-medium text-green-700 dark:text-green-300">
                                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                              Repair complete — let&apos;s lock it in.
                                            </p>
                                            <ReinforcementPanel
                                              conceptId={item.conceptId}
                                              failureReason={repair.failureReason}
                                              outcome="repair_complete"
                                            />
                                            <button
                                              onClick={() => handleDismissRepair(item.conceptId)}
                                              className="mt-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                                            >
                                              Continue →
                                            </button>
                                          </div>
                                        )}

                                        {nextAction[item.conceptId] === "leave_for_revision" && (
                                          <div className="mt-2.5">
                                            <p className="text-[11px] text-muted-foreground">
                                              Noted. This concept will come back in your normal revision — here&apos;s what to hold onto meanwhile.
                                            </p>
                                            <ReinforcementPanel
                                              conceptId={item.conceptId}
                                              failureReason={repair.failureReason}
                                              outcome="leave_for_revision"
                                            />
                                            <button
                                              onClick={() => handleDismissRepair(item.conceptId)}
                                              className="mt-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                                            >
                                              Continue →
                                            </button>
                                          </div>
                                        )}

                                        {nextAction[item.conceptId] === "offer_another_repair" && (
                                          <div className="mt-2.5">
                                            <p className="mb-1.5 text-[11px] text-muted-foreground">
                                              Let&apos;s try explaining this a different way.
                                            </p>
                                            <button
                                              onClick={() => handleRevisionAnotherRepair(item.conceptId)}
                                              disabled={repairLoading[item.conceptId]}
                                              className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 transition-colors disabled:opacity-50"
                                            >
                                              <BookOpen className="h-3.5 w-3.5" />
                                              {ctaConfig?.label ?? "Help me with this concept"}
                                              <ArrowRight className="h-3 w-3" />
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {/* Dismiss link — always available */}
                                    {!nextAction[item.conceptId] && repair.repairIntent === "clarification" && (
                                      <button
                                        onClick={() => handleDismissRepair(item.conceptId)}
                                        className="mt-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                                      >
                                        Done — move on →
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              }

              // ─── Default list item ──────────────────────
              return (
                <Card
                  key={item.conceptId}
                  className={cn(
                    "border-border/50 cursor-pointer hover:border-border/80 hover:shadow-sm transition-all",
                    item.isWeakArea && "border-l-2 border-l-amber-500"
                  )}
                  onClick={() => handleStartRevision(item.conceptId)}
                >
                  <CardContent className="flex items-center gap-4 px-4 py-3">
                    <div className={cn("rounded-md p-1.5", config.color)}>
                      <Icon className="h-4 w-4" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{item.conceptName}</p>
                        {item.isWeakArea && (
                          <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="secondary" className="text-[10px] h-4">
                          {item.subject}
                        </Badge>
                        {item.daysOverdue > 0 && (
                          <span className="text-[10px] text-muted-foreground">
                            {item.daysOverdue}d overdue
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-xs font-medium">{config.label}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {Math.round(item.forgettingProbability * 100)}% forgotten
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
