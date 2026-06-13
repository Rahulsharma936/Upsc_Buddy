"use client";

/**
 * RevisionList — Spaced repetition surface.
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
      // Use hydration API to reach ALL concepts (including historical)
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

              return (
                <Card key={item.conceptId} className={cn("border-border/50", item.isWeakArea && "border-l-2 border-l-amber-500")}>
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
