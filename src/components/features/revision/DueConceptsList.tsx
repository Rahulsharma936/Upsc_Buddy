"use client";

/**
 * DueConceptsList — read-only view of what is due and the revision stats.
 *
 * Replaces the old RevisionList on the Revision page. It deliberately has no
 * self-assessment: evidence comes from the session (questions and marked written answers), not
 * from a "did you remember?" button after the answer is shown.
 */

import type { ContentScope } from "@/lib/content-scope";
import { useCallback, useEffect, useState } from "react";
import { Clock, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface DueItem {
  conceptId: string;
  conceptName: string;
  subject: string;
  masteryLevel: string;
  forgettingProbability: number;
  isWeakArea: boolean;
  daysOverdue: number;
}

interface Stats {
  totalConcepts: number;
  mastered: number;
  reviewing: number;
  learning: number;
  unseen: number;
  weakAreas: number;
  dueNow: number;
  averageConfidence: number;
}

const SUBJECT_COLORS: Record<string, string> = {
  Polity: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  Geography: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  History: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  Economy: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  Ethics: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  CurrentAffairs: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
};

export function DueConceptsList({ refreshKey = 0, scope = "all" }: { refreshKey?: number; scope?: ContentScope }) {
  const [items, setItems] = useState<DueItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      fetch(`/api/revision?action=recommendations${scope === "all" ? "" : `&scope=${scope}`}`).then((r) => r.json()),
      fetch(`/api/revision?action=stats${scope === "all" ? "" : `&scope=${scope}`}`).then((r) => r.json()),
    ])
      .then(([rec, st]) => {
        setItems(rec?.success ? rec.data?.recommendations ?? [] : []);
        setStats(st?.success ? st.data?.stats ?? null : null);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [scope]);

  useEffect(() => {
    const id = window.setTimeout(load, 0);
    return () => window.clearTimeout(id);
  }, [load, refreshKey]);

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading what&apos;s due…
      </p>
    );
  }
  if (error) return <p className="text-sm text-muted-foreground">{error}</p>;

  return (
    <div className="space-y-3">
      {stats && (
        <Card className="border-border/60">
          <CardContent className="py-3">
            <button onClick={() => setShowStats((s) => !s)} className="flex w-full items-center justify-between text-sm" id="due-stats-toggle">
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span><span className="font-semibold">{stats.dueNow}</span> due now</span>
                <span className="text-muted-foreground">|</span>
                <span><span className="font-semibold text-green-600">{stats.mastered}</span> mastered</span>
                <span className="text-muted-foreground">|</span>
                <span><span className="font-semibold text-amber-600">{stats.weakAreas}</span> weak</span>
              </span>
              {showStats ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>
            {showStats && (
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <Stat label="Tracked" value={stats.totalConcepts} />
                <Stat label="Reviewing" value={stats.reviewing} />
                <Stat label="Learning" value={stats.learning} />
                <Stat label="Unseen" value={stats.unseen} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing due right now.</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{items.length} concept{items.length === 1 ? "" : "s"} due — start a session above to work through them.</p>
          <ul className="space-y-2">
            {items.map((it) => (
              <li key={it.conceptId}>
                <Card className="border-border/60">
                  <CardContent className="flex items-center justify-between gap-3 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{it.conceptName}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                          <Badge variant="secondary" className={cn("text-[10px]", SUBJECT_COLORS[it.subject])}>{it.subject}</Badge>
                          {it.daysOverdue > 0 && <span>{it.daysOverdue}d overdue</span>}
                          {it.isWeakArea && <span className="text-red-600">weak area</span>}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs capitalize">{it.masteryLevel}</p>
                      <p className="text-[10px] text-muted-foreground">{Math.round(it.forgettingProbability * 100)}% forgotten</p>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border/60 px-3 py-2">
      <p className="text-base font-semibold">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}
