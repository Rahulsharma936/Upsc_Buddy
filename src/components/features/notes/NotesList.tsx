"use client";

/**
 * NotesList — Client component that fetches and displays all notes.
 * Handles loading, empty states, subject filtering, and generation triggers.
 */

import { useState, useEffect, useCallback } from "react";
import { NoteCard } from "./NoteCard";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/EmptyState";
import { BookMarked, Filter } from "lucide-react";

interface ConceptWithNote {
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
  hasNote: boolean;
}

interface NotesResponse {
  items: ConceptWithNote[];
  summary: {
    totalConcepts: number;
    withNotes: number;
    withoutNotes: number;
  };
}

const SUBJECTS = ["All", "Polity", "History", "Geography", "Economics", "Science", "Environment"];

export function NotesList() {
  const [data, setData] = useState<NotesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSubject, setSelectedSubject] = useState("All");
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());

  const fetchNotes = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (selectedSubject !== "All") {
        params.set("subject", selectedSubject);
      }

      const res = await fetch(`/api/notes?${params.toString()}`);
      const json = await res.json();

      if (!json.success) {
        throw new Error(json.error?.message ?? "Failed to load notes");
      }

      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notes");
    } finally {
      setLoading(false);
    }
  }, [selectedSubject]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handleGenerate = async (conceptId: string) => {
    setGeneratingIds((prev) => new Set(prev).add(conceptId));

    try {
      const res = await fetch("/api/ai/generate-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conceptId, force: false }),
      });

      const json = await res.json();

      if (!json.success) {
        console.error("Note generation failed:", json.error);
        return;
      }

      // Refresh the list to show new note
      await fetchNotes();
    } catch (err) {
      console.error("Note generation error:", err);
    } finally {
      setGeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(conceptId);
        return next;
      });
    }
  };

  // ─── Loading State ────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <LoadingSpinner />
      </div>
    );
  }

  // ─── Error State ──────────────────────────────────────────
  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <button
          onClick={fetchNotes}
          className="mt-3 text-sm font-medium text-primary hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  // ─── Empty State ──────────────────────────────────────────
  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        icon={<BookMarked className="h-6 w-6" />}
        title="No concepts found"
        description="Submit a daily study log first, then extract concepts to generate notes."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* ─── Summary Bar ──────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex gap-4 text-sm">
          <span className="text-muted-foreground">
            <span className="font-semibold text-foreground">{data.summary.totalConcepts}</span> concepts
          </span>
          <span className="text-muted-foreground">
            <span className="font-semibold text-green-600 dark:text-green-400">{data.summary.withNotes}</span> with notes
          </span>
          <span className="text-muted-foreground">
            <span className="font-semibold text-amber-600 dark:text-amber-400">{data.summary.withoutNotes}</span> pending
          </span>
        </div>

        {/* ─── Subject Filter ────────────────────────────── */}
        <div className="flex items-center gap-1.5">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <div className="flex gap-1">
            {SUBJECTS.map((subject) => (
              <button
                key={subject}
                onClick={() => setSelectedSubject(subject)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  selectedSubject === subject
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {subject}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Notes Grid ───────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2 lg:gap-5 items-start">
        {data.items.map((item) => (
          <NoteCard
            key={item.concept.id}
            concept={item.concept}
            note={item.note}
            onGenerate={handleGenerate}
            isGenerating={generatingIds.has(item.concept.id)}
          />
        ))}
      </div>
    </div>
  );
}
