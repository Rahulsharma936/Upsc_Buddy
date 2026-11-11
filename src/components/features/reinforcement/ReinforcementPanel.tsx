"use client";

/**
 * ReinforcementPanel — the short, ready-made "lock it in" session shown right
 * after a repair (or a clarification) in Practice and Revision.
 *
 * Everything rendered here is RETRIEVED from the student's existing Knowledge
 * via GET /api/reinforce: their own note's core idea, memory hooks, exam
 * triggers, static↔current links, matched PYQs, one unseen transfer MCQ, and
 * related-concept "dominoes" with a question each. Nothing is generated.
 *
 * Answering a question here records a normal `mcq_attempt` through
 * POST /api/revision — the same path PracticeCard uses — so SM-2 sees it as
 * ordinary practice. No new event types, no new tables.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReinforcementSession } from "@/lib/reinforcement/reinforcement.service";
import type {
  ReinforcementMcq,
  ReinforcementOutcome,
  ReinforcementSection,
} from "@/lib/reinforcement/reinforcement.engine";

// ─── Props ──────────────────────────────────────────────────

export interface ReinforcementPanelProps {
  conceptId: string;
  /** The student's own reported reason for the miss, if any. */
  failureReason: string | null;
  outcome: ReinforcementOutcome;
  /** The MCQ just missed — never resurfaced as the transfer question. */
  excludeQuestionId?: string | null;
  excludeQuestionIndex?: number | null;
  /** Every question already visible around the panel (Practice shows the whole inventory). */
  excludeQuestionIds?: readonly string[] | null;
  excludeQuestionIndexes?: readonly number[] | null;
}

// ─── Section chrome ─────────────────────────────────────────

const SECTION_META: Record<ReinforcementSection, { title: string }> = {
  coreIdea: { title: "Core idea (your note)" },
  hooks: { title: "Memory hooks" },
  triggers: { title: "Exam triggers" },
  staticCurrent: { title: "Static and current linkage" },
  transferMcq: { title: "Another question" },
  pyqs: { title: "Previous year questions" },
  dominoes: { title: "Related concept" },
  mainsAngle: { title: "Mains angle" },
};

function SectionShell({
  section,
  children,
}: {
  section: ReinforcementSection;
  children: React.ReactNode;
}) {
  const { title } = SECTION_META[section];
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

// ─── Mini MCQ (records a normal mcq_attempt) ────────────────

function MiniMcq({ conceptId, mcq }: { conceptId: string; mcq: ReinforcementMcq }) {
  const [selected, setSelected] = useState<string | null>(null);

  const handleSelect = (opt: "a" | "b" | "c" | "d") => {
    if (selected) return;
    setSelected(opt);

    const isCorrect = opt === mcq.correctAnswer;
    // Same quality mapping as PracticeCard: correct → 4, incorrect → 1.
    fetch("/api/revision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conceptId,
        action: "mcq_attempt",
        quality: isCorrect ? 4 : 1,
        mcqCorrect: isCorrect,
        mcqQuestionIndex: mcq.questionIndex,
        ...(mcq.questionId ? { mcqQuestionId: mcq.questionId } : {}),
        selectedAnswer: opt,
        correctAnswer: mcq.correctAnswer,
      }),
    }).catch((err) => console.warn("[Reinforce] attempt save failed:", err));
  };

  const revealed = selected !== null;
  const correct = revealed && selected === mcq.correctAnswer;

  return (
    <div className="rounded-md border border-border bg-background px-3 py-2.5">
      <p className="mb-2 whitespace-pre-line text-xs font-medium leading-relaxed">{mcq.question}</p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {(["a", "b", "c", "d"] as const).map((opt) => {
          const isCorrectOpt = mcq.correctAnswer === opt;
          const isSelected = selected === opt;
          return (
            <button
              key={opt}
              onClick={() => handleSelect(opt)}
              disabled={revealed}
              className={cn(
                "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors",
                revealed && isCorrectOpt && "border-green-500/50 bg-green-50 dark:bg-green-500/10",
                revealed && isSelected && !isCorrectOpt && "border-red-500/50 bg-red-50 dark:bg-red-500/10",
                !revealed && "hover:bg-muted/50 cursor-pointer",
                revealed && "cursor-default",
              )}
              id={`reinforce-mcq-${mcq.questionIndex}-${opt}`}
            >
              <span className="w-4 shrink-0 text-[11px] font-semibold text-muted-foreground">({opt})</span>
              <span>{mcq.options[opt]}</span>
            </button>
          );
        })}
      </div>
      {revealed && (
        <div className="mt-2 rounded-md bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">{correct ? "Correct. " : `Incorrect. Answer: (${mcq.correctAnswer}). `}</span>
          {mcq.explanation}
        </div>
      )}
    </div>
  );
}

// ─── Panel ──────────────────────────────────────────────────

export function ReinforcementPanel({
  conceptId,
  failureReason,
  outcome,
  excludeQuestionId,
  excludeQuestionIndex,
  excludeQuestionIds,
  excludeQuestionIndexes,
}: ReinforcementPanelProps) {
  const idsCsv = (excludeQuestionIds ?? []).filter(Boolean).join(",");
  const indexesCsv = (excludeQuestionIndexes ?? []).join(",");
  // One state object keyed by the request it answers. "Loading" is derived
  // (result is for a different key), so the effect never sets state
  // synchronously — only from the fetch callbacks.
  const requestKey = [conceptId, failureReason ?? "", outcome, excludeQuestionId ?? "", excludeQuestionIndex ?? "", idsCsv, indexesCsv].join("|");
  const [result, setResult] = useState<{
    key: string;
    data: ReinforcementSession | null;
    error: string | null;
  } | null>(null);
  // React Strict Mode mounts twice in development; this keeps one request
  // per key instead of two identical ones.
  const inFlightKey = useRef<string | null>(null);

  useEffect(() => {
    if (inFlightKey.current === requestKey) return;
    inFlightKey.current = requestKey;
    // A response is stale only if the key moved on while it was in flight.
    // (No `cancelled` flag: Strict Mode's simulated unmount would mark the
    // one real request as cancelled and leave the panel loading forever.)
    const isCurrent = () => inFlightKey.current === requestKey;
    const params = new URLSearchParams({ conceptId, outcome });
    if (failureReason) params.set("failureReason", failureReason);
    if (excludeQuestionId) params.set("excludeQuestionId", excludeQuestionId);
    if (typeof excludeQuestionIndex === "number") {
      params.set("excludeQuestionIndex", String(excludeQuestionIndex));
    }
    if (idsCsv) params.set("excludeQuestionIds", idsCsv);
    if (indexesCsv) params.set("excludeQuestionIndexes", indexesCsv);

    fetch(`/api/reinforce?${params.toString()}`)
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          throw new Error(json?.error?.message || "Could not load reinforcement");
        }
        if (isCurrent()) setResult({ key: requestKey, data: json.data as ReinforcementSession, error: null });
      })
      .catch((err) => {
        if (isCurrent()) {
          setResult({
            key: requestKey,
            data: null,
            error: err instanceof Error ? err.message : "Could not load reinforcement",
          });
        }
      });
    // No cleanup on purpose: the ref keeps one request per key across Strict
    // Mode's double mount, and a real key change starts a new request.
  }, [requestKey, conceptId, failureReason, outcome, excludeQuestionId, excludeQuestionIndex, idsCsv, indexesCsv]);

  const loading = result?.key !== requestKey;
  const error = loading ? null : result?.error ?? null;
  const data = loading ? null : result?.data ?? null;

  if (loading) {
    return (
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground animate-pulse">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading from your notes…
      </p>
    );
  }

  if (error) {
    return <p className="mt-3 text-[11px] text-muted-foreground">Couldn&apos;t load your notes for this concept right now.</p>;
  }

  if (!data || data.order.length === 0) {
    return (
      <p className="mt-3 text-[11px] text-muted-foreground">
        Nothing more to pull in for this concept yet — generate its notes and questions from Knowledge first.
      </p>
    );
  }

  const { note, transferMcq, pyqs, dominoes, mainsAngle } = data;

  return (
    <div
      className="mt-3 space-y-3 rounded-lg border border-border bg-muted/20 px-4 py-3 animate-in fade-in duration-200"
      id={`reinforce-${conceptId}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground">Consolidate</p>
        <p className="text-[10px] text-muted-foreground">From your notes</p>
      </div>

      {data.order.map((section) => {
        switch (section) {
          case "coreIdea":
            return note?.coreIdea ? (
              <SectionShell key={section} section={section}>
                <p className="text-xs leading-relaxed text-foreground">{note.coreIdea}</p>
              </SectionShell>
            ) : null;

          case "hooks":
            return note && note.memoryHooks.length > 0 ? (
              <SectionShell key={section} section={section}>
                <ul className="space-y-0.5">
                  {note.memoryHooks.slice(0, 3).map((h, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-foreground">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                      {h}
                    </li>
                  ))}
                </ul>
              </SectionShell>
            ) : null;

          case "triggers":
            return note && note.examTriggers.length > 0 ? (
              <SectionShell key={section} section={section}>
                <div className="flex flex-wrap gap-1">
                  {note.examTriggers.slice(0, 4).map((t, i) => (
                    <span key={i} className="rounded border border-border px-2 py-0.5 text-[10px] font-medium text-foreground">
                      {t}
                    </span>
                  ))}
                </div>
              </SectionShell>
            ) : null;

          case "staticCurrent":
            return note && note.staticCurrentLink.length > 0 ? (
              <SectionShell key={section} section={section}>
                <ul className="space-y-0.5">
                  {note.staticCurrentLink.slice(0, 2).map((s, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-foreground">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                      {s}
                    </li>
                  ))}
                </ul>
              </SectionShell>
            ) : null;

          case "transferMcq":
            return transferMcq ? (
              <SectionShell key={section} section={section}>
                <MiniMcq conceptId={conceptId} mcq={transferMcq} />
              </SectionShell>
            ) : null;

          case "pyqs":
            return pyqs.length > 0 ? (
              <SectionShell key={section} section={section}>
                <ul className="space-y-1.5">
                  {pyqs.slice(0, 2).map((p, i) => (
                    <li key={i} className="text-xs leading-relaxed text-foreground">
                      <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {p.year} · {p.paper}
                      </span>
                      {p.question}
                    </li>
                  ))}
                </ul>
              </SectionShell>
            ) : null;

          case "dominoes":
            return dominoes.length > 0 ? (
              <SectionShell key={section} section={section}>
                <div className="space-y-2.5">
                  {dominoes.map((d) => (
                    <div key={d.conceptId} className="space-y-1.5">
                      <p className="text-xs text-foreground">
                        <span className="font-semibold">{d.conceptName}</span>
                        <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{d.relationshipType.replace(/_/g, " ")}</span>
                      </p>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">{d.reason}</p>
                      {d.coreIdea && <p className="text-xs leading-relaxed text-foreground">{d.coreIdea}</p>}
                      {d.mcq && <MiniMcq conceptId={d.conceptId} mcq={d.mcq} />}
                    </div>
                  ))}
                </div>
              </SectionShell>
            ) : null;

          case "mainsAngle":
            return mainsAngle ? (
              <SectionShell key={section} section={section}>
                <p className="text-xs italic leading-relaxed text-foreground">{mainsAngle}</p>
              </SectionShell>
            ) : null;
        }
      })}
    </div>
  );
}
