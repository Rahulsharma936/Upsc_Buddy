"use client";

/**
 * PYQSection — Displays matched Previous Year Questions for a concept.
 * Lightweight, productivity-oriented UI inside expanded NoteCard.
 *
 * Phase 2E: PYQ intelligence layer.
 */

import { useState, useEffect, useCallback } from "react";
import {
  FileQuestion,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Calendar,
  BookOpen,
  Lightbulb,
} from "lucide-react";

interface PYQMatch {
  pyqId: string;
  year: number;
  paper: string;
  examStage: string;
  question: string;
  subject: string;
  matchStrength: number;
  matchReason: string;
}

interface PYQSectionProps {
  conceptId: string;
}

const STAGE_COLORS: Record<string, string> = {
  mains: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  prelims: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
};

function MatchStrengthDot({ strength }: { strength: number }) {
  const color =
    strength >= 0.7 ? "bg-green-500" :
    strength >= 0.5 ? "bg-blue-500" :
    "bg-amber-500";

  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${color}`}
      title={`Match: ${Math.round(strength * 100)}%`}
    />
  );
}

export function PYQSection({ conceptId }: PYQSectionProps) {
  const [matches, setMatches] = useState<PYQMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [matching, setMatching] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchMatches = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/pyq-matches?conceptId=${conceptId}`);
      const json = await res.json();

      if (json.success) {
        setMatches(json.data.matches);
      }
    } catch (err) {
      console.error("Failed to fetch PYQ matches:", err);
    } finally {
      setLoading(false);
      setFetched(true);
    }
  }, [conceptId]);

  useEffect(() => {
    fetchMatches();
  }, [fetchMatches]);

  const handleMatch = async () => {
    setMatching(true);
    setError(null);
    try {
      const res = await fetch("/api/pyq-matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conceptId, force: matches.length > 0 }),
      });

      const json = await res.json();
      if (json.success) {
        setHasSearched(true);
        await fetchMatches();
      } else {
        setError("PYQ matching failed.");
      }
    } catch (err) {
      console.error("PYQ matching failed:", err);
      setError("Connection error.");
    } finally {
      setMatching(false);
    }
  };

  if (!fetched || loading) return null;

  // Empty state
  if (matches.length === 0) {
    return (
      <div className="mt-3 border-t border-border pt-3">
        {error && (
          <p className="text-[10px] text-red-500 mb-1.5">{error}</p>
        )}
        {hasSearched && !error ? (
          <p className="text-[10px] text-muted-foreground italic">
            No relevant past year questions found for this concept.
          </p>
        ) : (
          <button
            onClick={handleMatch}
            disabled={matching}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {matching ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
              <FileQuestion className="h-3 w-3" />
            )}
            {matching ? "Finding PYQs..." : "Find past year questions"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <FileQuestion className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Past Year Questions
          </span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {matches.length}
          </span>
        </div>
        <button
          onClick={handleMatch}
          disabled={matching}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {matching ? <RefreshCw className="h-3 w-3 animate-spin" /> : "Refresh"}
        </button>
      </div>

      <div className="space-y-2.5">
        {matches.map((match) => {
          const isExpanded = expandedId === match.pyqId;
          const stageColor = STAGE_COLORS[match.examStage] ?? STAGE_COLORS.mains;

          return (
            <div key={match.pyqId} className="rounded-lg border border-border/50 bg-muted/20">
              <button
                onClick={() => setExpandedId(isExpanded ? null : match.pyqId)}
                className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left"
              >
                <MatchStrengthDot strength={match.matchStrength} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground leading-relaxed line-clamp-3">
                    {match.question}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {match.year}
                    </span>
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${stageColor}`}>
                      {match.paper} · {match.examStage}
                    </span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {Math.round(match.matchStrength * 100)}%
                    </span>
                  </div>
                </div>
                {isExpanded ? (
                  <ChevronUp className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                )}
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 pt-0">
                  <div className="rounded-md bg-muted/40 px-3 py-2.5">
                    <div className="flex items-start gap-1.5">
                      <Lightbulb className="h-3 w-3 text-amber-500 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-foreground/80 leading-relaxed">
                        {match.matchReason}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
