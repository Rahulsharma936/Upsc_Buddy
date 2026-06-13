"use client";

/**
 * NoteCard — Displays a concept with its cognitive-compression revision note.
 * Collapsible sections, version badge, regeneration action.
 *
 * Sections: Core Idea, Exam Triggers, Static ↔ Current Link,
 * Answer-Writing Angles, Memory Hooks.
 */

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  BookOpen,
  Zap,
  Link2,
  PenTool,
  BrainCircuit,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { RelatedConcepts } from "./RelatedConcepts";
import { PYQSection } from "./PYQSection";

interface NoteCardProps {
  concept: {
    id: string;
    displayName: string;
    subject: string;
    keywords: string[];
    difficulty: string;
    confidence: number;
  };
  note: {
    id: string;
    version: number;
    coreIdea: string;
    examTriggers: string[];
    staticCurrentLink: string[];
    answerWritingAngles: string[];
    memoryHooks: string[];
    generatedBy: string;
    createdAt: string;
  } | null;
  onGenerate?: (conceptId: string) => void;
  isGenerating?: boolean;
}

const SUBJECT_COLORS: Record<string, string> = {
  Polity: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  History: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  Geography: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  Economics: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  Science: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  Environment: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
};

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  intermediate: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  advanced: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
};

export function NoteCard({ concept, note, onGenerate, isGenerating }: NoteCardProps) {
  const [expanded, setExpanded] = useState(false);

  const subjectColor = SUBJECT_COLORS[concept.subject] ?? "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
  const difficultyColor = DIFFICULTY_COLORS[concept.difficulty] ?? DIFFICULTY_COLORS.intermediate;

  return (
    <div className={`rounded-xl border border-border bg-card shadow-sm transition-all hover:shadow-md ${expanded ? "lg:col-span-2" : ""}`}>
      {/* ─── Header ────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 p-4 pb-3 lg:p-5 lg:pb-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-foreground leading-snug">
            {concept.displayName}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${subjectColor}`}>
              {concept.subject}
            </span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${difficultyColor}`}>
              {concept.difficulty}
            </span>
            {note && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                <Sparkles className="h-3 w-3" />
                v{note.version}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {onGenerate && (
            <button
              onClick={() => onGenerate(concept.id)}
              disabled={isGenerating}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              title={note ? "Regenerate notes" : "Generate notes"}
            >
              <RefreshCw className={`h-3 w-3 ${isGenerating ? "animate-spin" : ""}`} />
              {note ? "Regen" : "Generate"}
            </button>
          )}
          {note && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      {/* ─── No Note State ─────────────────────────────────── */}
      {!note && !isGenerating && (
        <div className="border-t border-border px-4 py-6 text-center">
          <BookOpen className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">
            No notes generated yet
          </p>
        </div>
      )}

      {/* ─── Generating State ──────────────────────────────── */}
      {isGenerating && (
        <div className="border-t border-border px-4 py-6 text-center">
          <RefreshCw className="mx-auto h-8 w-8 text-primary animate-spin" />
          <p className="mt-2 text-sm text-muted-foreground">
            Generating revision notes...
          </p>
        </div>
      )}

      {/* ─── Core Idea (always visible when note exists) ───── */}
      {note && !isGenerating && (
        <div className="border-t border-border px-4 py-3 lg:px-5 lg:py-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Zap className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Core Idea
            </span>
          </div>
          <p className="text-sm text-foreground/90 leading-relaxed font-medium lg:text-[15px]">
            {note.coreIdea}
          </p>
        </div>
      )}

      {/* ─── Expanded Sections ─────────────────────────────── */}
      {note && expanded && !isGenerating && (
        <div className="border-t border-border divide-y divide-border">
          {/* Exam Triggers */}
          {note.examTriggers.length > 0 && (
            <div className="px-4 py-3 lg:px-5 lg:py-4">
              <div className="flex items-center gap-1.5 mb-2.5">
                <Zap className="h-4 w-4 text-red-500" />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Exam Triggers
                </span>
              </div>
              <ul className="space-y-2">
                {note.examTriggers.map((trigger, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-foreground/80 leading-relaxed">
                    <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-500" />
                    <span>{trigger}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Static ↔ Current Link */}
          {note.staticCurrentLink.length > 0 && (
            <div className="px-4 py-3 lg:px-5 lg:py-4">
              <div className="flex items-center gap-1.5 mb-2.5">
                <Link2 className="h-4 w-4 text-blue-500" />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Static ↔ Current Link
                </span>
              </div>
              <ul className="space-y-2">
                {note.staticCurrentLink.map((link, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-foreground/80 leading-relaxed">
                    <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-500" />
                    <span>{link}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Answer-Writing Angles */}
          {note.answerWritingAngles.length > 0 && (
            <div className="px-4 py-3 lg:px-5 lg:py-4">
              <div className="flex items-center gap-1.5 mb-2.5">
                <PenTool className="h-4 w-4 text-emerald-500" />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Answer-Writing Angles
                </span>
              </div>
              <ul className="space-y-2">
                {note.answerWritingAngles.map((angle, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-foreground/80 leading-relaxed">
                    <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500" />
                    <span>{angle}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Memory Hooks */}
          {note.memoryHooks.length > 0 && (
            <div className="px-4 py-3 lg:px-5 lg:py-4">
              <div className="flex items-center gap-1.5 mb-2.5">
                <BrainCircuit className="h-4 w-4 text-purple-500" />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Memory Hooks
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {note.memoryHooks.map((hook, i) => (
                  <span
                    key={i}
                    className="inline-block rounded-lg bg-purple-50 px-3 py-1.5 text-xs text-purple-700 dark:bg-purple-900/20 dark:text-purple-300 leading-snug"
                  >
                    {hook}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Related Concepts */}
          <div className="px-4 py-3 lg:px-5 lg:py-4">
            <RelatedConcepts
              conceptId={concept.id}
              conceptName={concept.displayName}
            />
          </div>

          {/* PYQ Matches */}
          <div className="px-4 py-3 lg:px-5 lg:py-4">
            <PYQSection conceptId={concept.id} />
          </div>

          {/* Generation Info */}
          <div className="px-4 py-2.5 bg-muted/30">
            <p className="text-xs text-muted-foreground">
              Generated by <span className="font-medium">{note.generatedBy}</span>
              {" · "}
              {new Date(note.createdAt).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
