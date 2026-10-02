"use client";

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
} from "lucide-react";

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
      const res = await fetch("/api/notes");
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

      // Show brief completion feedback
      setCompletedConcepts((prev) => ({
        ...prev,
        [conceptId]: {
          assessment,
          intervalDays: json.data?.intervalDays,
        },
      }));

      // Clear active state
      setActiveConceptId(null);
      setMaterialRevealed(false);
      setConceptNote(null);

      // Remove from list after a brief moment
      setTimeout(() => {
        setRecommendations((prev) => prev.filter((r) => r.conceptId !== conceptId));
        setCompletedConcepts((prev) => {
          const next = { ...prev };
          delete next[conceptId];
          return next;
        });
        // Refresh stats
        fetch("/api/revision?action=stats")
          .then((r) => r.json())
          .then((j) => {
            if (j.success) setStats(j.data?.stats ?? null);
          })
          .catch(() => {});
      }, 1200);
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

                          {/* Self-assessment buttons */}
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
