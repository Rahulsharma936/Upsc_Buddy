"use client";

/**
 * DiagnosticView — R2.6 Diagnostic Experience
 *
 * Shows the student their learning gaps across three views:
 * 1. Health summary — quick at-a-glance status
 * 2. Priority queue — concepts to repair first
 * 3. Diagnosis detail — per-concept explanations
 *
 * Uses GET /api/diagnostic?action=overview for the overview,
 * and GET /api/diagnostic?conceptId=X for per-concept detail.
 *
 * Design: mentor-like, not analytics dashboard. Clarity over numbers.
 */

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn } from "@/lib/utils";
import {
  Stethoscope,
  Brain,
  Clock,
  AlertTriangle,
  Target,
  SkipForward,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  ShieldCheck,
  RefreshCw,
  MessageCircle,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────

interface DiagnosisSummaryItem {
  conceptId: string;
  primaryDiagnosis: string | null;
  primaryScore: number;
  activeDiagnosisCount: number;
  evidenceCount: number;
}

interface DiagnosticOverview {
  totalConcepts: number;
  conceptsWithDiagnosis: number;
  byDiagnosis: {
    concept_gap: string[];
    memory_gap: string[];
    calibration_gap: string[];
    revision_gap: string[];
  };
  highestPriority: DiagnosisSummaryItem[];
  summary: DiagnosisSummaryItem[];
  generatedAt: string;
}

interface FeatureContribution {
  featureName: string;
  featureValue: string | number | boolean | null;
  contributionWeight: number;
  description: string;
}

interface ConceptDiagnosis {
  conceptId: string;
  type: string;
  score: number;
  active: boolean;
  topContributions: FeatureContribution[];
  explanation: string;
}

interface ConceptReport {
  conceptId: string;
  diagnoses: ConceptDiagnosis[];
  primaryDiagnosis: ConceptDiagnosis | null;
  evidenceCount: number;
  generatedAt: string;
}

interface ConceptDetailData {
  report: ConceptReport;
  features: Record<string, unknown>;
}

// ─── Diagnosis Config ───────────────────────────────────────

const DIAGNOSIS_META: Record<string, {
  label: string;
  shortLabel: string;
  icon: typeof Brain;
  color: string;
  bgColor: string;
  borderColor: string;
  description: string;
}> = {
  concept_gap: {
    label: "Concept Gap",
    shortLabel: "Concept",
    icon: Brain,
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-50 dark:bg-red-950/30",
    borderColor: "border-red-200 dark:border-red-900/50",
    description: "The concept isn't understood well enough yet",
  },
  memory_gap: {
    label: "Memory Gap",
    shortLabel: "Memory",
    icon: Clock,
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-50 dark:bg-amber-950/30",
    borderColor: "border-amber-200 dark:border-amber-900/50",
    description: "Previously learned but starting to fade",
  },
  calibration_gap: {
    label: "Calibration Gap",
    shortLabel: "Calibration",
    icon: Target,
    color: "text-purple-600 dark:text-purple-400",
    bgColor: "bg-purple-50 dark:bg-purple-950/30",
    borderColor: "border-purple-200 dark:border-purple-900/50",
    description: "Confidence doesn't match actual performance",
  },
  revision_gap: {
    label: "Revision Gap",
    shortLabel: "Revision",
    icon: SkipForward,
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-950/30",
    borderColor: "border-blue-200 dark:border-blue-900/50",
    description: "Not enough practice or revision happening",
  },
};

// ─── Human-readable explanation helpers ─────────────────────

/** Convert technical feature descriptions to student-friendly language. */
function humanizeDescription(desc: string): string {
  return desc
    .replace(/MCQ accuracy is (\d+%)/g, "You got $1 of questions right")
    .replace(/Recent MCQ accuracy is (\d+%)/g, "Recently, only $1 correct")
    .replace(/(\d+) consecutive MCQ failures/g, "You missed the last $1 questions in a row")
    .replace(/Same wrong answer selected repeatedly — possible misconception/g,
      "You keep choosing the same wrong answer — there may be a misunderstanding")
    .replace(/days since last successful recall/g, "days since you last got this right")
    .replace(/Review interval has decreased — retention loss detected/g,
      "Your review schedule had to be shortened because of forgetting")
    .replace(/Revision recall success rate is (\d+%)/g,
      "You remembered this correctly only $1 of the time during revision")
    .replace(/knowledge may be decaying/g, "this knowledge may be fading")
    .replace(/Recent accuracy ([\d%]+) is below historical ([\d%]+)/g,
      "Recent performance ($1) has dropped from your best ($2)")
    .replace(/Confidence-outcome mismatch rate is (\d+%)/g,
      "$1 of the time, your confidence didn't match your result")
    .replace(/(\d+) miscalibrated events?/g,
      "$1 times your confidence didn't match the outcome")
    .replace(/Skipped revision (\d+) times?/g, "You skipped revision $1 time(s)")
    .replace(/Skip rate is (\d+%) of revision sessions/g,
      "You skipped $1 of your revision sessions")
    .replace(/No engagement for (\d+) days/g,
      "You haven't studied this in $1 days")
    .replace(/— reducing \w+ Gap/g, "");
}

// ─── Main Component ─────────────────────────────────────────

export function DiagnosticView() {
  const [overview, setOverview] = useState<DiagnosticOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedConcept, setExpandedConcept] = useState<string | null>(null);
  const [conceptDetail, setConceptDetail] = useState<ConceptDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"priority" | "all">("priority");

  // ── Fetch overview ──────────────────────────────────────
  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/diagnostic?action=overview");
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to load");
      setOverview(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load diagnostic data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOverview(); }, [fetchOverview]);

  // ── Fetch concept detail ────────────────────────────────
  const fetchConceptDetail = useCallback(async (conceptId: string) => {
    if (expandedConcept === conceptId) {
      setExpandedConcept(null);
      setConceptDetail(null);
      return;
    }
    setExpandedConcept(conceptId);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/diagnostic?conceptId=${encodeURIComponent(conceptId)}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to load");
      setConceptDetail(json.data);
    } catch {
      setConceptDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [expandedConcept]);

  // ── Loading ─────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner />
        <span className="ml-3 text-sm text-muted-foreground">Analyzing your learning patterns…</span>
      </div>
    );
  }

  // ── Error ───────────────────────────────────────────────
  if (error) {
    return (
      <Card className="border-destructive/30">
        <CardContent className="p-6 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={fetchOverview}>
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Empty state ─────────────────────────────────────────
  if (!overview || overview.totalConcepts === 0) {
    return (
      <EmptyState
        icon={<Stethoscope className="h-6 w-6" />}
        title="No learning data yet"
        description="Start practicing or revising concepts to see your diagnostic report. The system needs at least a few interactions to analyze your learning patterns."
      />
    );
  }

  const healthyCount = overview.totalConcepts - overview.conceptsWithDiagnosis;
  const healthPercent = overview.totalConcepts > 0
    ? Math.round((healthyCount / overview.totalConcepts) * 100)
    : 100;

  return (
    <div className="space-y-6">
      {/* ── Health Summary Cards ────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <HealthCard
          label="Concepts Tracked"
          value={overview.totalConcepts}
          icon={<Brain className="h-4 w-4" />}
          accent="text-foreground"
        />
        <HealthCard
          label="Healthy"
          value={healthyCount}
          sub={`${healthPercent}% of total`}
          icon={<CheckCircle2 className="h-4 w-4" />}
          accent="text-green-600 dark:text-green-400"
        />
        <HealthCard
          label="Need Attention"
          value={overview.conceptsWithDiagnosis}
          sub={overview.conceptsWithDiagnosis === 0 ? "All clear!" : undefined}
          icon={<AlertTriangle className="h-4 w-4" />}
          accent={overview.conceptsWithDiagnosis > 0
            ? "text-amber-600 dark:text-amber-400"
            : "text-green-600 dark:text-green-400"}
        />
        <HealthCard
          label="Top Priority"
          value={overview.highestPriority.length > 0
            ? shortenId(overview.highestPriority[0].conceptId)
            : "—"}
          sub={overview.highestPriority.length > 0
            ? getDiagLabel(overview.highestPriority[0].primaryDiagnosis)
            : "Nothing urgent"}
          icon={<Target className="h-4 w-4" />}
          accent="text-foreground"
          isText
        />
      </div>

      {/* ── Diagnosis Type Breakdown ───────────────────── */}
      {overview.conceptsWithDiagnosis > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <h2 className="text-sm font-semibold">Diagnosis Breakdown</h2>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(Object.entries(DIAGNOSIS_META) as [string, typeof DIAGNOSIS_META[string]][]).map(
                ([type, meta]) => {
                  const count = overview.byDiagnosis[type as keyof typeof overview.byDiagnosis]?.length ?? 0;
                  const Icon = meta.icon;
                  return (
                    <div
                      key={type}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border p-3 transition-colors",
                        count > 0 ? meta.borderColor : "border-border/50 opacity-50"
                      )}
                    >
                      <div className={cn("rounded-md p-1.5", count > 0 ? meta.bgColor : "bg-muted")}>
                        <Icon className={cn("h-4 w-4", count > 0 ? meta.color : "text-muted-foreground")} />
                      </div>
                      <div>
                        <div className="text-lg font-semibold tabular-nums">{count}</div>
                        <div className="text-xs text-muted-foreground">{meta.label}</div>
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── All Clear Banner ───────────────────────────── */}
      {overview.conceptsWithDiagnosis === 0 && overview.totalConcepts > 0 && (
        <Card className="border-green-200 bg-green-50/50 dark:border-green-900/50 dark:bg-green-950/20">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-full bg-green-100 p-3 dark:bg-green-900/40">
              <ShieldCheck className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h3 className="font-semibold text-green-900 dark:text-green-100">
                All concepts are healthy
              </h3>
              <p className="mt-0.5 text-sm text-green-700 dark:text-green-300">
                No learning gaps detected across {overview.totalConcepts} concepts.
                Keep up the great work!
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Tab Selector ───────────────────────────────── */}
      {overview.conceptsWithDiagnosis > 0 && (
        <div className="flex items-center gap-2">
          <Button
            variant={activeTab === "priority" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("priority")}
          >
            Priority Queue
          </Button>
          <Button
            variant={activeTab === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("all")}
          >
            All Concepts
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={fetchOverview} className="gap-1.5 text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      )}

      {/* ── Concept List ───────────────────────────────── */}
      {overview.conceptsWithDiagnosis > 0 && (
        <div className="space-y-2">
          {(activeTab === "priority" ? overview.highestPriority : overview.summary)
            .filter((item) => activeTab === "all" || item.activeDiagnosisCount > 0)
            .map((item) => (
              <ConceptCard
                key={item.conceptId}
                item={item}
                isExpanded={expandedConcept === item.conceptId}
                detail={expandedConcept === item.conceptId ? conceptDetail : null}
                detailLoading={expandedConcept === item.conceptId && detailLoading}
                onToggle={() => fetchConceptDetail(item.conceptId)}
              />
            ))}
        </div>
      )}
    </div>
  );
}

// ─── Health Summary Card ────────────────────────────────────

function HealthCard({ label, value, sub, icon, accent, isText }: {
  label: string;
  value: number | string;
  sub?: string;
  icon: React.ReactNode;
  accent: string;
  isText?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <span className={cn("opacity-60", accent)}>{icon}</span>
        </div>
        <div className={cn(
          "mt-2 font-semibold tracking-tight",
          isText ? "text-base truncate" : "text-2xl tabular-nums",
          accent
        )}>
          {value}
        </div>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ─── Concept Card ───────────────────────────────────────────

function ConceptCard({ item, isExpanded, detail, detailLoading, onToggle }: {
  item: DiagnosisSummaryItem;
  isExpanded: boolean;
  detail: ConceptDetailData | null;
  detailLoading: boolean;
  onToggle: () => void;
}) {
  const diagMeta = item.primaryDiagnosis ? DIAGNOSIS_META[item.primaryDiagnosis] : null;
  const Icon = diagMeta?.icon ?? CheckCircle2;
  const hasIssue = item.activeDiagnosisCount > 0;

  return (
    <Card className={cn(
      "transition-all duration-200",
      isExpanded && "ring-1 ring-primary/20",
      hasIssue ? diagMeta?.borderColor : "border-border/50"
    )}>
      {/* Header row */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted/30 transition-colors"
        id={`diagnostic-concept-${item.conceptId}`}
      >
        <div className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          hasIssue ? diagMeta?.bgColor : "bg-green-50 dark:bg-green-950/30"
        )}>
          <Icon className={cn("h-4 w-4",
            hasIssue ? diagMeta?.color : "text-green-600 dark:text-green-400"
          )} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">
              {shortenId(item.conceptId)}
            </span>
            {hasIssue && diagMeta && (
              <Badge variant="outline" className={cn("text-[10px] font-medium", diagMeta.color, diagMeta.borderColor)}>
                {diagMeta.shortLabel}
              </Badge>
            )}
            {item.activeDiagnosisCount > 1 && (
              <Badge variant="secondary" className="text-[10px]">
                +{item.activeDiagnosisCount - 1} more
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {hasIssue
              ? diagMeta?.description
              : "No issues detected"
            }
          </p>
        </div>

        {hasIssue && (
          <div className="shrink-0 text-right mr-2">
            <ScoreIndicator score={item.primaryScore} />
          </div>
        )}

        <div className="shrink-0 text-muted-foreground">
          {isExpanded
            ? <ChevronUp className="h-4 w-4" />
            : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="border-t px-4 py-4">
          {detailLoading ? (
            <div className="flex items-center gap-2 py-4 justify-center">
              <LoadingSpinner />
              <span className="text-xs text-muted-foreground">Loading details…</span>
            </div>
          ) : detail ? (
            <ConceptDetail report={detail.report} />
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              Unable to load details for this concept.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Concept Detail (expanded) ──────────────────────────────

function ConceptDetail({ report }: { report: ConceptReport }) {
  const activeDiagnoses = report.diagnoses.filter((d) => d.active);
  const inactiveDiagnoses = report.diagnoses.filter((d) => !d.active);

  return (
    <div className="space-y-4">
      {/* Active diagnoses */}
      {activeDiagnoses.length > 0 ? (
        <div className="space-y-3">
          {activeDiagnoses
            .sort((a, b) => b.score - a.score)
            .map((d) => (
              <DiagnosisCard key={d.type} diagnosis={d} isPrimary={report.primaryDiagnosis?.type === d.type} />
            ))}
        </div>
      ) : (
        <div className="rounded-lg bg-green-50 p-4 text-center dark:bg-green-950/20">
          <CheckCircle2 className="mx-auto mb-2 h-5 w-5 text-green-600 dark:text-green-400" />
          <p className="text-sm font-medium text-green-900 dark:text-green-100">No issues detected</p>
          <p className="mt-0.5 text-xs text-green-700 dark:text-green-300">
            Based on {report.evidenceCount} learning events
          </p>
        </div>
      )}

      {/* Inactive diagnoses summary */}
      {inactiveDiagnoses.length > 0 && activeDiagnoses.length > 0 && (
        <div className="pt-2 border-t">
          <p className="text-xs font-medium text-muted-foreground mb-2">Not currently active</p>
          <div className="flex flex-wrap gap-2">
            {inactiveDiagnoses.map((d) => {
              const meta = DIAGNOSIS_META[d.type];
              return (
                <span key={d.type} className="text-xs text-muted-foreground/70">
                  {meta?.label ?? d.type}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/50 pt-1">
        Based on {report.evidenceCount} events · Generated {formatTimestamp(report.generatedAt)}
      </p>

      {/* ── Self-Report Prompt ──────────────────────── */}
      <SelfReportPrompt conceptId={report.conceptId} />
    </div>
  );
}

// ─── Single Diagnosis Card ──────────────────────────────────

function DiagnosisCard({ diagnosis, isPrimary }: {
  diagnosis: ConceptDiagnosis;
  isPrimary: boolean;
}) {
  const meta = DIAGNOSIS_META[diagnosis.type];
  if (!meta) return null;
  const Icon = meta.icon;

  // Get positive contributions only for the "Why?" section
  const reasons = diagnosis.topContributions
    .filter((c) => c.contributionWeight > 0)
    .map((c) => humanizeDescription(c.description));

  return (
    <div className={cn(
      "rounded-lg border p-4",
      meta.borderColor,
      meta.bgColor,
    )}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4", meta.color)} />
          <span className={cn("text-sm font-semibold", meta.color)}>
            {meta.label}
          </span>
          {isPrimary && (
            <Badge className="text-[10px] bg-foreground/10 text-foreground border-0">
              Primary
            </Badge>
          )}
        </div>
        <ScoreIndicator score={diagnosis.score} />
      </div>

      {/* Why? section */}
      {reasons.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-foreground/70">Why?</p>
          <ul className="space-y-1">
            {reasons.map((reason, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-foreground/80">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-40" />
                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Self-Report Prompt (R2 Enhancement) ────────────────────

const SELF_REPORT_OPTIONS = [
  {
    value: "concept_understanding",
    label: "I don\u2019t understand this concept",
  },
  {
    value: "memory_retrieval",
    label: "I understand it but keep forgetting",
  },
  {
    value: "question_performance",
    label: "I understand it but make mistakes in questions",
  },
  {
    value: "revision_need",
    label: "I haven\u2019t revised it enough",
  },
  {
    value: "uncertain",
    label: "I\u2019m not sure what\u2019s going wrong",
  },
] as const;

function SelfReportPrompt({ conceptId }: { conceptId: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = async (difficulty: string) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/diagnostic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conceptId, difficulty }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed");
      setSubmitted(difficulty);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    const selected = SELF_REPORT_OPTIONS.find((o) => o.value === submitted);
    return (
      <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
        <div className="flex items-center gap-2 mb-1">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-primary">Thanks for sharing!</span>
        </div>
        <p className="text-xs text-muted-foreground">
          You said: &ldquo;{selected?.label}&rdquo; — this helps improve your diagnosis.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-border/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <MessageCircle className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">What feels difficult about this concept?</span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Your feedback helps us understand your perspective — it won&apos;t override your actual performance data.
      </p>
      <div className="space-y-1.5">
        {SELF_REPORT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => handleSelect(opt.value)}
            disabled={submitting}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md border border-border/40 px-3 py-2",
              "text-left text-xs transition-all duration-150",
              "hover:bg-muted/50 hover:border-border",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            )}
            id={`self-report-${opt.value}-${conceptId}`}
          >

            <span>{opt.label}</span>
          </button>
        ))}
      </div>
      {error && (
        <p className="mt-2 text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}

// ─── Score Indicator ────────────────────────────────────────

function ScoreIndicator({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const severity = pct >= 70 ? "text-red-600 dark:text-red-400"
    : pct >= 40 ? "text-amber-600 dark:text-amber-400"
    : "text-muted-foreground";

  return (
    <span className={cn("text-xs font-semibold tabular-nums", severity)}>
      {pct}%
    </span>
  );
}

// ─── Utilities ──────────────────────────────────────────────

function shortenId(id: string): string {
  // Show first 8 chars of UUID or full name if it's a concept name
  if (id.includes("-") && id.length > 20) {
    return id.substring(0, 8) + "…";
  }
  return id;
}

function getDiagLabel(type: string | null): string {
  if (!type) return "Healthy";
  return DIAGNOSIS_META[type]?.label ?? type;
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHrs = Math.round(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}
