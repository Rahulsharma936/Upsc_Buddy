"use client";

/**
 * PracticeCard — Displays questions for a single concept.
 * Progressive disclosure: expand sections on demand.
 * Clean, exam-focused, zero gamification.
 */

import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  HelpCircle,
  FileText,
  Mic,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PracticeCardProps {
  data: {
    conceptId: string;
    conceptName: string;
    subject: string;
    prelimsMcqs: {
      question: string;
      options: { a: string; b: string; c: string; d: string };
      correctAnswer: string;
      explanation: string;
      difficulty: string;
    }[];
    mainsQuestions: {
      question: string;
      guidancePoints: string[];
      estimatedMarks: number;
      paperRelevance: string;
    }[];
    interviewPrompts: {
      prompt: string;
      expectedDimensions: string[];
      difficulty: string;
    }[];
  };
  mode: string;
  onGenerate?: (conceptId: string) => void;
  isGenerating?: boolean;
}

const SUBJECT_COLORS: Record<string, string> = {
  Polity: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  Geography: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  History: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  Economy: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  Ethics: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  CurrentAffairs: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
};

export function PracticeCard({ data, mode }: PracticeCardProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
  const [showExplanation, setShowExplanation] = useState<Record<number, boolean>>({});

  const toggle = (section: string) =>
    setExpandedSection((prev) => (prev === section ? null : section));

  const handleMCQAnswer = (qIdx: number, answer: string) => {
    setSelectedAnswers((prev) => ({ ...prev, [qIdx]: answer }));
    setShowExplanation((prev) => ({ ...prev, [qIdx]: true }));
  };

  const showPrelims = mode === "All" || mode === "Prelims";
  const showMains = mode === "All" || mode === "Mains";
  const showInterview = mode === "All" || mode === "Interview";

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <h3 className="text-base font-semibold">{data.conceptName}</h3>
            <Badge
              variant="secondary"
              className={cn("text-[10px] font-medium", SUBJECT_COLORS[data.subject])}
            >
              {data.subject}
            </Badge>
          </div>
          <div className="flex gap-1.5 text-[10px] text-muted-foreground">
            {data.prelimsMcqs.length > 0 && (
              <span className="rounded bg-muted px-1.5 py-0.5">{data.prelimsMcqs.length} MCQ</span>
            )}
            {data.mainsQuestions.length > 0 && (
              <span className="rounded bg-muted px-1.5 py-0.5">{data.mainsQuestions.length} Mains</span>
            )}
            {data.interviewPrompts.length > 0 && (
              <span className="rounded bg-muted px-1.5 py-0.5">{data.interviewPrompts.length} Interview</span>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-2 pt-0">
        {/* ─── Prelims MCQs ─────────────────────────────────── */}
        {showPrelims && data.prelimsMcqs.length > 0 && (
          <div className="rounded-lg border border-border/40">
            <button
              onClick={() => toggle("prelims")}
              className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/30 transition-colors"
            >
              <span className="flex items-center gap-2">
                <HelpCircle className="h-3.5 w-3.5 text-blue-500" />
                Prelims MCQs
              </span>
              {expandedSection === "prelims" ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>

            {expandedSection === "prelims" && (
              <div className="space-y-4 border-t px-4 py-3">
                {data.prelimsMcqs.map((mcq, idx) => (
                  <div key={idx} className="space-y-2">
                    <p className="text-sm font-medium leading-relaxed">
                      Q{idx + 1}. {mcq.question}
                    </p>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {(["a", "b", "c", "d"] as const).map((opt) => {
                        const selected = selectedAnswers[idx] === opt;
                        const isCorrect = mcq.correctAnswer === opt;
                        const answered = selectedAnswers[idx] !== undefined;

                        return (
                          <button
                            key={opt}
                            onClick={() => !answered && handleMCQAnswer(idx, opt)}
                            disabled={answered}
                            className={cn(
                              "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                              answered && isCorrect && "border-green-500/50 bg-green-50 dark:bg-green-500/10",
                              answered && selected && !isCorrect && "border-red-500/50 bg-red-50 dark:bg-red-500/10",
                              !answered && "hover:bg-muted/50 cursor-pointer",
                              answered && "cursor-default"
                            )}
                          >
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold">
                              {opt.toUpperCase()}
                            </span>
                            <span>{mcq.options[opt]}</span>
                            {answered && isCorrect && <CheckCircle2 className="ml-auto h-4 w-4 text-green-600 shrink-0" />}
                            {answered && selected && !isCorrect && <XCircle className="ml-auto h-4 w-4 text-red-500 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                    {showExplanation[idx] && (
                      <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground leading-relaxed">
                        <span className="font-medium text-foreground">Explanation:</span> {mcq.explanation}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── Mains Questions ──────────────────────────────── */}
        {showMains && data.mainsQuestions.length > 0 && (
          <div className="rounded-lg border border-border/40">
            <button
              onClick={() => toggle("mains")}
              className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/30 transition-colors"
            >
              <span className="flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 text-violet-500" />
                Mains Questions
              </span>
              {expandedSection === "mains" ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>

            {expandedSection === "mains" && (
              <div className="space-y-4 border-t px-4 py-3">
                {data.mainsQuestions.map((q, idx) => (
                  <div key={idx} className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium leading-relaxed">{q.question}</p>
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {q.estimatedMarks}m
                      </Badge>
                    </div>
                    <div className="rounded-md bg-muted/30 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                        Guidance Points
                      </p>
                      <ul className="space-y-0.5">
                        {q.guidancePoints.map((gp, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/40" />
                            {gp}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── Interview Prompts ─────────────────────────────── */}
        {showInterview && data.interviewPrompts.length > 0 && (
          <div className="rounded-lg border border-border/40">
            <button
              onClick={() => toggle("interview")}
              className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/30 transition-colors"
            >
              <span className="flex items-center gap-2">
                <Mic className="h-3.5 w-3.5 text-amber-500" />
                Interview Prompts
              </span>
              {expandedSection === "interview" ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>

            {expandedSection === "interview" && (
              <div className="space-y-3 border-t px-4 py-3">
                {data.interviewPrompts.map((p, idx) => (
                  <div key={idx} className="space-y-1.5">
                    <p className="text-sm font-medium italic leading-relaxed">"{p.prompt}"</p>
                    <div className="flex flex-wrap gap-1">
                      {p.expectedDimensions.map((dim, i) => (
                        <span
                          key={i}
                          className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
                        >
                          {dim}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
