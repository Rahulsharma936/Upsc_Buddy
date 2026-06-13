"use client";

/**
 * InsightsDashboard — Meta-cognition surface.
 * Displays adaptive intelligence: strengths, coverage, gaps, patterns, recommendations.
 * Sparse, meaningful, explainable. No noisy charts.
 */

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Lightbulb,
  BookOpen,
  Target,
  Layers,
  ArrowRight,
} from "lucide-react";

interface SubjectStrength {
  subject: string;
  score: number;
  conceptCount: number;
  masteryDistribution: { mastered: number; reviewing: number; learning: number; unseen: number };
  averageConfidence: number;
  weakConceptCount: number;
  evidence: string[];
}

interface PaperCoverage {
  paper: string;
  totalSubtopics: number;
  coveredSubtopics: number;
  coveragePercent: number;
  domains: {
    domain: string;
    totalSubtopics: number;
    coveredSubtopics: number;
    coveragePercent: number;
    uncoveredSubtopics: string[];
  }[];
}

interface ConceptGap {
  type: string;
  description: string;
  subject: string;
  severity: "low" | "moderate" | "high";
  evidence: string;
}

interface StudyPatterns {
  subjectBalance: number;
  dominantSubject: string | null;
  neglectedSubject: string | null;
  untouchedSubjects: string[];
  averageConceptsPerSubject: number;
  distribution: Record<string, number>;
}

interface Recommendation {
  type: string;
  target: string;
  targetType: string;
  reason: string;
  priority: number;
  signals: string[];
}

interface AdaptiveData {
  subjectStrengths: SubjectStrength[];
  syllabusCoverage: PaperCoverage[];
  conceptGaps: ConceptGap[];
  studyPatterns: StudyPatterns;
  recommendations: Recommendation[];
  stats: {
    totalConcepts: number;
    totalMasteryRecords: number;
    totalMappedSubtopics: number;
    computationTimeMs: number;
  };
}

const SEVERITY_COLORS = {
  high: "text-red-600 bg-red-500/10",
  moderate: "text-amber-600 bg-amber-500/10",
  low: "text-blue-600 bg-blue-500/10",
};

const SUBJECT_BARS: Record<string, string> = {
  Polity: "bg-blue-500",
  Geography: "bg-emerald-500",
  History: "bg-amber-500",
  Economy: "bg-violet-500",
  Ethics: "bg-rose-500",
  CurrentAffairs: "bg-cyan-500",
};

export function InsightsDashboard() {
  const [data, setData] = useState<AdaptiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/adaptive?action=profile");
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to load insights");
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <LoadingSpinner />
        <p className="text-sm text-muted-foreground">Computing adaptive intelligence…</p>
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

  if (!data || data.stats.totalConcepts === 0) {
    return (
      <EmptyState
        icon={<BarChart3 className="h-6 w-6" />}
        title="No data yet"
        description="Start studying and logging concepts to see adaptive insights about your preparation."
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* ─── Recommendations (top priority) ──────────────────── */}
      {data.recommendations.length > 0 && (
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.recommendations.slice(0, 5).map((rec, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 rounded-lg border border-border/30 px-3 py-2.5"
              >
                <ArrowRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary/60" />
                <div className="min-w-0">
                  <p className="text-sm">{rec.reason}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <Badge variant="secondary" className="text-[10px] h-4">
                      {rec.type}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {rec.targetType}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ─── Subject Strengths ───────────────────────────────── */}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <TrendingUp className="h-4 w-4 text-green-500" />
            Subject Strengths
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.subjectStrengths.map((s) => (
            <div key={s.subject} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{s.subject}</span>
                <span className="text-xs text-muted-foreground">
                  {s.conceptCount > 0 ? `${Math.round(s.score * 100)}%` : "—"}
                  {s.conceptCount > 0 && (
                    <span className="ml-1.5">{s.conceptCount} concepts</span>
                  )}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    SUBJECT_BARS[s.subject] ?? "bg-primary"
                  )}
                  style={{ width: `${Math.round(s.score * 100)}%` }}
                />
              </div>
              {s.weakConceptCount > 0 && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  {s.weakConceptCount} weak area{s.weakConceptCount !== 1 ? "s" : ""}
                </p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ─── GS Coverage + Concept Gaps (side-by-side on desktop) ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Coverage */}
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Target className="h-4 w-4 text-blue-500" />
              GS Coverage
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.syllabusCoverage.map((paper) => (
              <div key={paper.paper} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{paper.paper}</span>
                  <span className="text-xs text-muted-foreground">
                    {paper.coveredSubtopics}/{paper.totalSubtopics} subtopics ({paper.coveragePercent}%)
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all duration-500"
                    style={{ width: `${paper.coveragePercent}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Gaps */}
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Layers className="h-4 w-4 text-amber-500" />
              Concept Gaps
              {data.conceptGaps.length > 0 && (
                <Badge variant="secondary" className="text-[10px] h-4 ml-1">
                  {data.conceptGaps.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.conceptGaps.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                No significant gaps detected yet.
              </p>
            ) : (
              <div className="space-y-2">
                {data.conceptGaps.slice(0, 6).map((gap, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2 rounded-md border border-border/30 px-3 py-2"
                  >
                    <Badge
                      variant="secondary"
                      className={cn("text-[10px] shrink-0 mt-0.5", SEVERITY_COLORS[gap.severity])}
                    >
                      {gap.severity}
                    </Badge>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {gap.description}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── Study Balance ───────────────────────────────────── */}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <BookOpen className="h-4 w-4 text-violet-500" />
            Study Balance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div className="rounded-lg bg-muted/40 px-3 py-2 text-center">
              <p className="text-lg font-bold">{Math.round(data.studyPatterns.subjectBalance * 100)}%</p>
              <p className="text-[10px] text-muted-foreground">Balance</p>
            </div>
            {data.studyPatterns.dominantSubject && (
              <div className="flex items-center gap-1.5 text-xs">
                <TrendingUp className="h-3 w-3 text-green-500" />
                <span>Strongest: <span className="font-medium">{data.studyPatterns.dominantSubject}</span></span>
              </div>
            )}
            {data.studyPatterns.neglectedSubject && (
              <div className="flex items-center gap-1.5 text-xs">
                <TrendingDown className="h-3 w-3 text-amber-500" />
                <span>Needs attention: <span className="font-medium">{data.studyPatterns.neglectedSubject}</span></span>
              </div>
            )}
            {data.studyPatterns.untouchedSubjects.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <AlertTriangle className="h-3 w-3" />
                <span>Untouched: {data.studyPatterns.untouchedSubjects.join(", ")}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
