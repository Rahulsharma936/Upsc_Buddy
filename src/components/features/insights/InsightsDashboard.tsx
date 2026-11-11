"use client";

/**
 * InsightsDashboard — what the student has shown, then what they have studied.
 *
 * Top half: answer evidence (live, from recorded answers): accuracy per
 * subject, concepts whose latest answer was wrong, misses by the student's
 * stated cause, and recommendations drawn from that evidence.
 *
 * Bottom half: study logs (cached adaptive profile): syllabus subtopics the
 * logged concepts map to, unstudied areas and subject balance. These describe
 * what was studied, not what is known, and are labelled that way.
 */

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/EmptyState";
import { ContentScopeFilter } from "@/components/shared/ContentScopeFilter";
import { cn } from "@/lib/utils";
import { BarChart3 } from "lucide-react";
import type { ContentScope } from "@/lib/content-scope";
import { MISS_CAUSE_LABEL, type AnswerEvidence, type MissCause } from "@/lib/insights/answer-evidence";

interface PaperCoverage {
  paper: string;
  totalSubtopics: number;
  coveredSubtopics: number;
  coveragePercent: number;
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
}

interface AdaptiveData {
  syllabusCoverage: PaperCoverage[];
  conceptGaps: ConceptGap[];
  studyPatterns: StudyPatterns;
  stats: { totalConcepts: number };
}

const SEVERITY_COLORS = {
  high: "text-red-700 dark:text-red-300",
  moderate: "text-amber-700 dark:text-amber-300",
  low: "text-muted-foreground",
};

const CAUSES: MissCause[] = ["knowledge", "calibration", "execution", "unexplained"];

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** "CurrentAffairs" → "Current Affairs". */
const subjectLabel = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2");

function accuracyTone(a: number): string {
  if (a >= 0.7) return "bg-emerald-600";
  if (a >= 0.5) return "bg-amber-500";
  return "bg-red-600";
}

export function InsightsDashboard() {
  const [profile, setProfile] = useState<{ data: AdaptiveData | null; error: string | null } | null>(null);
  const [scope, setScope] = useState<ContentScope>("all");
  const [evidence, setEvidence] = useState<{ scope: ContentScope; data: AnswerEvidence | null; error: string | null } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/adaptive?action=profile")
      .then((r) => r.json())
      .then((json) => {
        if (alive) setProfile(json?.success ? { data: json.data, error: null } : { data: null, error: json?.error?.message ?? "Failed to load insights" });
      })
      .catch(() => {
        if (alive) setProfile({ data: null, error: "Failed to load insights" });
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/insights/evidence${scope === "all" ? "" : `?scope=${scope}`}`)
      .then((r) => r.json())
      .then((json) => {
        if (alive)
          setEvidence(json?.success ? { scope, data: json.data, error: null } : { scope, data: null, error: json?.error?.message ?? "Failed to load answers" });
      })
      .catch(() => {
        if (alive) setEvidence({ scope, data: null, error: "Failed to load answers" });
      });
    return () => {
      alive = false;
    };
  }, [scope, reloadKey]);

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <LoadingSpinner />
        <p className="text-sm text-muted-foreground">Loading insights…</p>
      </div>
    );
  }

  if (profile.error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <p className="text-sm text-destructive">{profile.error}</p>
        <button onClick={() => setReloadKey((k) => k + 1)} className="mt-3 text-sm font-medium text-primary hover:underline">
          Try again
        </button>
      </div>
    );
  }

  const data = profile.data;
  if (!data || data.stats.totalConcepts === 0) {
    return (
      <EmptyState
        icon={<BarChart3 className="h-6 w-6" />}
        title="No data yet"
        description="Log what you study and answer Practice or Revision questions to see insights about your preparation."
      />
    );
  }

  const ev = evidence?.scope === scope ? evidence : null;

  return (
    <div className="space-y-5">
      {/* ─── What your answers show ─────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">What your answers show</h2>
          <p className="text-xs text-muted-foreground">From the MCQs, repair checks and written answers you have attempted. Updated as you answer.</p>
        </div>
        <ContentScopeFilter value={scope} onChange={setScope} idPrefix="insights-scope" />
      </div>

      {!ev && <LoadingSpinner />}
      {ev?.error && <p className="text-sm text-destructive">{ev.error}</p>}
      {ev?.data && <EvidenceSection e={ev.data} />}

      {/* ─── What you have studied (logs) ───────────────────── */}
      <div className="pt-2">
        <h2 className="text-base font-semibold">What you have studied</h2>
        <p className="text-xs text-muted-foreground">From the concepts you have logged. This shows what you have covered, not how well you know it.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Syllabus studied</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3" id="insights-coverage">
            {data.syllabusCoverage.map((paper) => (
              <div key={paper.paper} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{paper.paper}</span>
                  <span className="text-xs text-muted-foreground">
                    {paper.coveredSubtopics} of {paper.totalSubtopics} subtopics logged ({paper.coveragePercent}%)
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-slate-500" style={{ width: `${paper.coveragePercent}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Unstudied areas</CardTitle>
          </CardHeader>
          <CardContent>
            {data.conceptGaps.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No unstudied areas next to what you have logged.</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {data.conceptGaps.slice(0, 6).map((gap, idx) => (
                  <li key={idx} className="flex gap-2">
                    <span className={cn("w-16 shrink-0 font-medium capitalize", SEVERITY_COLORS[gap.severity])}>{gap.severity}</span>
                    <span className="text-muted-foreground">{gap.description}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Study balance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
            <span>
              <span className="text-lg font-semibold tabular-nums">{Math.round(data.studyPatterns.subjectBalance * 100)}%</span>{" "}
              <span className="text-muted-foreground">balance across subjects</span>
            </span>
            {data.studyPatterns.dominantSubject && (
              <span>
                Most studied: <span className="font-medium">{data.studyPatterns.dominantSubject}</span>
              </span>
            )}
            {data.studyPatterns.neglectedSubject && (
              <span>
                Least studied: <span className="font-medium">{data.studyPatterns.neglectedSubject}</span>
              </span>
            )}
            {data.studyPatterns.untouchedSubjects.length > 0 && (
              <span className="text-muted-foreground">Not started: {data.studyPatterns.untouchedSubjects.join(", ")}</span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EvidenceSection({ e }: { e: AnswerEvidence }) {
  const t = e.totals;
  if (t.answers === 0) {
    return (
      <Card className="border-border/60">
        <CardContent className="py-6 text-sm text-muted-foreground" id="insights-evidence">
          No answers yet{t.concepts ? ` on these ${t.concepts} concepts` : ""}. Answer Practice or Revision questions and this section fills in.
        </CardContent>
      </Card>
    );
  }
  const totalMisses = CAUSES.reduce((n, c) => n + e.missesByCause[c], 0);

  return (
    <div className="space-y-4" id="insights-evidence">
      {e.recommendations.length > 0 && (
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">What to do next</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm" id="insights-recommendations">
              {e.recommendations.map((r, i) => (
                <li key={i} className="border-l-2 border-border pl-3">
                  {r.text}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Accuracy by subject</CardTitle>
          <p className="text-xs text-muted-foreground" id="insights-evidence-summary">
            {t.answers} answers on {t.conceptsTested} of {t.concepts} concepts: {pct(t.accuracy ?? 0)} correct.
            {t.recovered > 0 && ` ${t.recovered} concept${t.recovered === 1 ? "" : "s"} recovered after a miss.`}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {e.subjects.map((s) => (
            <div key={s.subject} className="space-y-1" data-subject={s.subject}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">{subjectLabel(s.subject)}</span>
                <span className="text-xs text-muted-foreground">
                  {s.accuracy === null
                    ? "Not tested yet"
                    : s.tooFewToJudge
                      ? `${s.answers} answer${s.answers === 1 ? "" : "s"}, too few to judge`
                      : `${pct(s.accuracy)} correct, ${s.answers} answers`}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                {s.accuracy !== null && (
                  <div
                    className={cn("h-full rounded-full", s.tooFewToJudge ? "bg-muted-foreground/40" : accuracyTone(s.accuracy))}
                    style={{ width: `${Math.max(2, Math.round(s.accuracy * 100))}%` }}
                  />
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {s.conceptsTested} of {s.concepts} concepts tested
                {s.mcqTotal > 0 && `, MCQs ${s.mcqRight} of ${s.mcqTotal} right`}
                {s.needsWork > 0 && `, ${s.needsWork} need${s.needsWork === 1 ? "s" : ""} work`}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Needs work</CardTitle>
            <p className="text-xs text-muted-foreground">Concepts whose latest answer was wrong. Slips you marked as misreading or carelessness are not counted.</p>
          </CardHeader>
          <CardContent>
            {e.needsWork.length === 0 ? (
              <p className="text-sm text-muted-foreground">None. Every concept you missed has since been answered correctly.</p>
            ) : (
              <ul className="space-y-1.5 text-xs" id="insights-needs-work">
                {e.needsWork.slice(0, 8).map((c) => (
                  <li key={c.conceptId} className="flex items-baseline justify-between gap-3">
                    <span>
                      <span className="font-medium text-foreground">{c.name}</span> <span className="text-muted-foreground">{subjectLabel(c.subject)}</span>
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {c.misses > 1 ? `missed ${c.misses} times` : "missed once"}
                      {c.latestCause && c.latestCause !== "unexplained" && `, ${MISS_CAUSE_LABEL[c.latestCause].toLowerCase()}`}
                    </span>
                  </li>
                ))}
                {e.needsWork.length > 8 && <li className="text-muted-foreground">and {e.needsWork.length - 8} more</li>}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Why answers were missed</CardTitle>
            <p className="text-xs text-muted-foreground">From the reason you gave after each wrong MCQ. Failed repair checks and low written marks count as not knowing.</p>
          </CardHeader>
          <CardContent>
            {totalMisses === 0 ? (
              <p className="text-sm text-muted-foreground">No misses recorded.</p>
            ) : (
              <ul className="space-y-1.5 text-xs" id="insights-causes">
                {CAUSES.filter((c) => e.missesByCause[c] > 0).map((c) => (
                  <li key={c} className="flex items-baseline justify-between gap-3">
                    <span>{MISS_CAUSE_LABEL[c]}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {e.missesByCause[c]} ({pct(e.missesByCause[c] / totalMisses)})
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {t.skips > 0 && <p className="mt-2 text-[11px] text-muted-foreground">{t.skips} questions skipped (not counted as answers).</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
