"use client";

/**
 * RelatedConcepts — Lightweight relationship display for a concept.
 * Shows related concepts with type badges, strength indicators,
 * and expandable reasoning sections.
 *
 * Phase 2D: Minimal, productivity-oriented UI.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Link2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Scale,
  BookOpen,
  Landmark,
  Globe,
  History,
  Lightbulb,
  TrendingUp,
  Building2,
  ArrowRightLeft,
  GitCompareArrows,
  Newspaper,
  HeartHandshake,
} from "lucide-react";

interface RelationshipData {
  id: string;
  sourceConcept: { displayName: string; subject: string };
  targetConcept: { displayName: string; subject: string };
  relationshipType: string;
  strength: number;
  reason: string;
  crossSubject: boolean;
  createdAt: string;
}

interface RelatedConceptsProps {
  conceptId: string;
  conceptName: string;
}

const TYPE_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  constitutional_link: { label: "Constitutional", icon: Scale, color: "text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/20" },
  governance_link: { label: "Governance", icon: Landmark, color: "text-purple-600 bg-purple-50 dark:text-purple-400 dark:bg-purple-900/20" },
  economic_impact: { label: "Economic", icon: TrendingUp, color: "text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-900/20" },
  policy_interaction: { label: "Policy", icon: Building2, color: "text-indigo-600 bg-indigo-50 dark:text-indigo-400 dark:bg-indigo-900/20" },
  ethical_dimension: { label: "Ethical", icon: HeartHandshake, color: "text-rose-600 bg-rose-50 dark:text-rose-400 dark:bg-rose-900/20" },
  historical_context: { label: "Historical", icon: History, color: "text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/20" },
  geographic_relevance: { label: "Geographic", icon: Globe, color: "text-teal-600 bg-teal-50 dark:text-teal-400 dark:bg-teal-900/20" },
  current_affairs_connection: { label: "Current Affairs", icon: Newspaper, color: "text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-900/20" },
  institutional_relationship: { label: "Institutional", icon: Building2, color: "text-slate-600 bg-slate-50 dark:text-slate-400 dark:bg-slate-900/20" },
  cause_effect: { label: "Cause-Effect", icon: ArrowRightLeft, color: "text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-900/20" },
  comparative_relation: { label: "Comparative", icon: GitCompareArrows, color: "text-cyan-600 bg-cyan-50 dark:text-cyan-400 dark:bg-cyan-900/20" },
};

function StrengthBar({ strength }: { strength: number }) {
  const percentage = Math.round(strength * 100);
  const color =
    strength >= 0.8 ? "bg-green-500" :
    strength >= 0.6 ? "bg-blue-500" :
    strength >= 0.4 ? "bg-amber-500" :
    "bg-gray-400";

  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${percentage}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground tabular-nums">{percentage}%</span>
    </div>
  );
}

export function RelatedConcepts({ conceptId, conceptName }: RelatedConceptsProps) {
  const [relationships, setRelationships] = useState<RelationshipData[]>([]);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasExtracted, setHasExtracted] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchRelationships = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/ai/extract-relationships?conceptId=${conceptId}`);
      const json = await res.json();

      if (json.success) {
        setRelationships(json.data.relationships);
      }
    } catch (err) {
      console.error("Failed to fetch relationships:", err);
    } finally {
      setLoading(false);
      setFetched(true);
    }
  }, [conceptId]);

  useEffect(() => {
    fetchRelationships();
  }, [fetchRelationships]);

  const handleExtract = async () => {
    setExtracting(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/extract-relationships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conceptId, force: relationships.length > 0 }),
      });

      const json = await res.json();
      if (json.success) {
        setHasExtracted(true);
        await fetchRelationships();
      } else {
        setError("Extraction failed. Try again.");
      }
    } catch (err) {
      console.error("Relationship extraction failed:", err);
      setError("Connection error. Is Ollama running?");
    } finally {
      setExtracting(false);
    }
  };

  // Don't render until first fetch completes
  if (!fetched || loading) return null;

  // No relationships found
  if (relationships.length === 0) {
    return (
      <div className="mt-3 border-t border-border pt-3">
        {error && (
          <p className="text-[10px] text-red-500 mb-1.5">{error}</p>
        )}
        {hasExtracted && !error ? (
          <p className="text-[10px] text-muted-foreground italic">
            No strong analytical links found for this concept.
          </p>
        ) : (
          <button
            onClick={handleExtract}
            disabled={extracting}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {extracting ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
              <Link2 className="h-3 w-3" />
            )}
            {extracting ? "Finding links..." : "Find related concepts"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Related Concepts
          </span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {relationships.length}
          </span>
        </div>
        <button
          onClick={handleExtract}
          disabled={extracting}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {extracting ? <RefreshCw className="h-3 w-3 animate-spin" /> : "Refresh"}
        </button>
      </div>

      <div className="space-y-2.5">
        {relationships.map((rel) => {
          const config = TYPE_CONFIG[rel.relationshipType] ?? {
            label: rel.relationshipType,
            icon: Link2,
            color: "text-gray-600 bg-gray-50",
          };
          const Icon = config.icon;
          const isExpanded = expandedId === rel.id;
          const otherConcept =
            rel.sourceConcept.displayName === conceptName
              ? rel.targetConcept
              : rel.sourceConcept;

          return (
            <div key={rel.id} className="rounded-lg border border-border/50 bg-muted/20">
              <button
                onClick={() => setExpandedId(isExpanded ? null : rel.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
              >
                <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${config.color.split(" ")[0]}`} />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground truncate block">
                    {otherConcept.displayName}
                  </span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${config.color}`}>
                      {config.label}
                    </span>
                    {rel.crossSubject && (
                      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-primary/10 text-primary">
                        Cross-subject
                      </span>
                    )}
                    <StrengthBar strength={rel.strength} />
                  </div>
                </div>
                {isExpanded ? (
                  <ChevronUp className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                )}
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 pt-0">
                  <div className="rounded-md bg-muted/40 px-3 py-2.5">
                    <div className="flex items-start gap-1.5">
                      <Lightbulb className="h-3 w-3 text-amber-500 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-foreground/80 leading-relaxed">
                        {rel.reason}
                      </p>
                    </div>
                    <p className="mt-1.5 text-[10px] text-muted-foreground">
                      {otherConcept.subject} · {new Date(rel.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                    </p>
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
