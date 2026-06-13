"use client";

/**
 * PracticeList — Cognitive Practice Surface.
 *
 * Fetches today's curated practice set from the surfacing engine.
 * NOT a dump of all generated questions.
 *
 * Displays:
 * - Today's Practice (budgeted, paced)
 * - Can switch to Full Inventory view
 * - Hydration-aware states (generating vs empty vs populated)
 */

import { useState, useEffect, useCallback } from "react";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/EmptyState";
import { PracticeCard } from "./PracticeCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Swords,
  Filter,
  Zap,
  Loader2,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Layers,
  Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SurfacedItem {
  conceptId: string;
  conceptName: string;
  subject: string;
  reason: string;
  priorityScore: number;
  prelimsMcqs: any[];
  mainsQuestions: any[];
  interviewPrompts: any[];
}

interface DailyPracticeData {
  mode: string;
  surfaced: SurfacedItem[];
  deferredCount: number;
  date: string;
  totalConcepts: number;
  inventorySize: number;
  hydratedPercent: number;
  budget?: {
    maxConcepts: number;
    totalInventory: number;
  };
  composition?: {
    revisionLinked: number;
    weakArea: number;
    newConcept: number;
    deferred: number;
  };
  // inventory mode fields
  concepts?: SurfacedItem[];
}

const PRACTICE_MODES = ["All", "Prelims", "Mains", "Interview"] as const;
type PracticeMode = (typeof PRACTICE_MODES)[number];

const REASON_LABELS: Record<string, { label: string; color: string }> = {
  weak_area: { label: "Weak Area", color: "bg-red-500/10 text-red-600 dark:text-red-400" },
  revision_due: { label: "Revision Due", color: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  new_concept: { label: "New", color: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  deferred: { label: "Deferred", color: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
  subject_balance: { label: "Coverage", color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
};

type ViewMode = "daily" | "inventory";

export function PracticeList() {
  const [data, setData] = useState<DailyPracticeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<PracticeMode>("All");
  const [viewMode, setViewMode] = useState<ViewMode>("daily");
  const [backfilling, setBackfilling] = useState(false);
  const [showComposition, setShowComposition] = useState(false);

  const fetchPractice = useCallback(async (vm: ViewMode) => {
    try {
      setLoading(true);
      setError(null);

      const url = vm === "inventory"
        ? "/api/practice?mode=inventory"
        : "/api/practice";

      const res = await fetch(url);
      const json = await res.json();

      if (json.success) {
        setData(json.data);
      } else {
        throw new Error(json.error?.message ?? "Failed to load practice");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPractice(viewMode);
  }, [fetchPractice, viewMode]);

  const handleBackfill = async () => {
    setBackfilling(true);
    try {
      // Use hydration API which processes ALL concepts (including historical)
      await fetch("/api/ai/hydrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 10, layers: ["questions", "revision"] }),
      });
      await fetchPractice(viewMode);
    } catch {
      // Silent
    } finally {
      setBackfilling(false);
    }
  };

  const items = viewMode === "inventory"
    ? data?.concepts ?? []
    : data?.surfaced ?? [];

  // Filter by mode
  const filtered = items.filter((c) => {
    if (mode === "All") return true;
    if (mode === "Prelims") return c.prelimsMcqs?.length > 0;
    if (mode === "Mains") return c.mainsQuestions?.length > 0;
    if (mode === "Interview") return c.interviewPrompts?.length > 0;
    return true;
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <LoadingSpinner />
        <p className="text-sm text-muted-foreground">Loading practice…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <button onClick={() => fetchPractice(viewMode)} className="mt-3 text-sm font-medium text-primary hover:underline">
          Try again
        </button>
      </div>
    );
  }

  // Hydration state: concepts exist but no questions generated
  if (data && data.inventorySize === 0 && data.totalConcepts > 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="rounded-full bg-violet-500/10 p-4">
          <Swords className="h-8 w-8 text-violet-500" />
        </div>
        <div className="text-center space-y-1.5">
          <h3 className="text-base font-semibold">Practice intelligence not yet generated</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            You have {data.totalConcepts} concept{data.totalConcepts !== 1 ? "s" : ""} but practice questions haven't been generated yet.
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
              Generating questions…
            </>
          ) : (
            <>
              <Zap className="h-4 w-4" />
              Generate Practice Questions
            </>
          )}
        </Button>
      </div>
    );
  }

  // No concepts at all
  if (!data || data.totalConcepts === 0) {
    return (
      <EmptyState
        icon={<Swords className="h-6 w-6" />}
        title="No concepts yet"
        description="Submit a daily study log to extract concepts. Practice questions will be generated automatically."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* ─── Header: View toggle + info ─────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        {/* View mode toggle */}
        <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-0.5">
          <button
            onClick={() => setViewMode("daily")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              viewMode === "daily"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Calendar className="h-3.5 w-3.5" />
            Today's Practice
          </button>
          <button
            onClick={() => setViewMode("inventory")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              viewMode === "inventory"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Layers className="h-3.5 w-3.5" />
            Full Inventory
          </button>
        </div>

        {/* Hydration indicator */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {data.inventorySize}/{data.totalConcepts} concepts hydrated
          </span>
          {data.hydratedPercent < 100 && data.totalConcepts > data.inventorySize && (
            <button
              onClick={handleBackfill}
              disabled={backfilling}
              className="text-primary hover:underline text-xs"
            >
              {backfilling ? "Generating…" : "Hydrate more"}
            </button>
          )}
        </div>
      </div>

      {/* ─── Daily practice composition ──────────────────── */}
      {viewMode === "daily" && data.composition && items.length > 0 && (
        <button
          onClick={() => setShowComposition(!showComposition)}
          className="flex w-full items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-4 py-2 text-xs"
        >
          <div className="flex items-center gap-3 text-muted-foreground">
            <span>
              <span className="font-semibold text-foreground">{items.length}</span>
              {" "}concept{items.length !== 1 ? "s" : ""} surfaced
            </span>
            {data.deferredCount > 0 && (
              <>
                <span className="text-border">·</span>
                <span>{data.deferredCount} deferred</span>
              </>
            )}
          </div>
          {showComposition ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
      )}

      {showComposition && data.composition && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-center">
          {[
            { label: "Weak Areas", value: data.composition.weakArea, color: "text-red-600" },
            { label: "Revision Due", value: data.composition.revisionLinked, color: "text-amber-600" },
            { label: "New Concepts", value: data.composition.newConcept, color: "text-blue-600" },
            { label: "Deferred", value: data.composition.deferred, color: "text-violet-600" },
          ].map((item) => (
            <div key={item.label} className="rounded-lg bg-muted/20 px-3 py-2">
              <p className={cn("text-lg font-bold", item.color)}>{item.value}</p>
              <p className="text-[10px] text-muted-foreground">{item.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ─── Mode filter ─────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <div className="flex gap-1">
          {PRACTICE_MODES.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                mode === m
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} concept{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ─── Practice cards ──────────────────────────────── */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<Swords className="h-6 w-6" />}
          title={viewMode === "daily" ? "All caught up" : "No matching questions"}
          description={viewMode === "daily"
            ? "No practice surfaced for this filter. Try a different mode or check back later."
            : "No questions match this filter in inventory."
          }
        />
      ) : (
        <div className="space-y-4">
          {filtered.map((item) => {
            const reasonInfo = REASON_LABELS[item.reason];

            return (
              <div key={item.conceptId} className="relative">
                {/* Surfacing reason badge (daily mode only) */}
                {viewMode === "daily" && reasonInfo && (
                  <div className="absolute -top-2 right-3 z-10">
                    <Badge
                      variant="secondary"
                      className={cn("text-[9px] px-1.5 py-0", reasonInfo.color)}
                    >
                      {reasonInfo.label}
                    </Badge>
                  </div>
                )}

                <PracticeCard
                  data={{
                    conceptId: item.conceptId,
                    conceptName: item.conceptName,
                    subject: item.subject,
                    prelimsMcqs: item.prelimsMcqs ?? [],
                    mainsQuestions: item.mainsQuestions ?? [],
                    interviewPrompts: item.interviewPrompts ?? [],
                  }}
                  mode={mode}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Refresh button (daily mode) ──────────────────── */}
      {viewMode === "daily" && items.length > 0 && (
        <div className="flex justify-center pt-2">
          <button
            onClick={() => fetchPractice("daily")}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Refresh practice set
          </button>
        </div>
      )}
    </div>
  );
}
