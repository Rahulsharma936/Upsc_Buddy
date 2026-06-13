"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatRelativeDate, formatDate } from "@/lib/utils/date";
import { SUBJECT_MAP } from "@/lib/constants/subjects";
import {
  BrainCircuit,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  RotateCcw,
} from "lucide-react";
import type { DailyLogDisplay } from "@/types/daily-log.types";

interface LogCardProps {
  log: DailyLogDisplay;
}

/**
 * Extraction status types returned by the API.
 * Added per Audit 1 — Task 4 (extraction error visibility).
 */
type ExtractionStatus =
  | "success"
  | "empty"
  | "ai_unavailable"
  | "in_flight"
  | "partial"
  | "error";

interface ExtractResult {
  status: "idle" | "success" | "error" | "warning";
  extractionStatus?: ExtractionStatus;
  message: string;
  canRetry: boolean;
}

export function LogCard({ log }: LogCardProps) {
  const [extracting, setExtracting] = useState(false);
  const [extractResult, setExtractResult] = useState<ExtractResult>({
    status: "idle",
    message: "",
    canRetry: false,
  });

  /**
   * Run concept extraction (normal or forced re-extract).
   * Task 3 — Re-extract support.
   */
  const handleExtract = async (force = false) => {
    setExtracting(true);
    setExtractResult({ status: "idle", message: "", canRetry: false });

    try {
      const res = await fetch("/api/ai/extract-concepts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dailyLogId: log.id, force }),
      });

      const json = await res.json();

      if (!json.success) {
        setExtractResult({
          status: "error",
          message: json.error?.message ?? "Extraction failed",
          canRetry: true,
        });
        return;
      }

      const data = json.data;
      const extractionStatus = data?.extractionStatus as ExtractionStatus | undefined;
      const userMessage = data?.userMessage as string | undefined;
      const persisted = data?.stats?.persisted ?? 0;

      // ─── Task 4: Differentiated feedback based on extraction status ───
      switch (extractionStatus) {
        case "success":
          setExtractResult({
            status: "success",
            extractionStatus,
            message: userMessage ?? `Extracted ${persisted} concepts`,
            canRetry: false,
          });
          break;

        case "ai_unavailable":
          setExtractResult({
            status: "error",
            extractionStatus,
            message: userMessage ?? "AI service is not available",
            canRetry: true,
          });
          break;

        case "in_flight":
          setExtractResult({
            status: "warning",
            extractionStatus,
            message: userMessage ?? "Extraction is still processing",
            canRetry: false,
          });
          break;

        case "empty":
        case "partial":
          setExtractResult({
            status: "warning",
            extractionStatus,
            message: userMessage ?? "No concepts extracted",
            canRetry: true,
          });
          break;

        case "error":
        default:
          setExtractResult({
            status: persisted > 0 ? "success" : "error",
            extractionStatus,
            message: userMessage ?? `Extracted ${persisted} concepts`,
            canRetry: persisted === 0,
          });
          break;
      }
    } catch (err) {
      setExtractResult({
        status: "error",
        message: err instanceof Error ? err.message : "Network error",
        canRetry: true,
      });
    } finally {
      setExtracting(false);
    }
  };

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {formatRelativeDate(log.date)}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatDate(log.date)}
            </p>
          </div>
        </div>

        <p className="mt-3 text-sm text-foreground/80 line-clamp-3">
          {log.rawInput}
        </p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {(log.subjects as string[]).map((subject) => (
            <Badge key={subject} variant="secondary" className="text-xs font-normal">
              {SUBJECT_MAP[subject]?.label ?? subject}
            </Badge>
          ))}
        </div>

        {log.concepts && (log.concepts as string[]).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {(log.concepts as string[]).map((concept) => (
              <span
                key={concept}
                className="rounded-md bg-primary/5 px-2 py-0.5 text-[11px] text-primary"
              >
                {concept}
              </span>
            ))}
          </div>
        )}

        {/* ─── Extract / Re-extract Buttons (Audit 1, Task 3) ──── */}
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => handleExtract(false)}
            disabled={extracting}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
          >
            {extracting ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <BrainCircuit className="h-3.5 w-3.5" />
            )}
            {extracting ? "Extracting..." : "Extract Concepts"}
          </button>

          {/* Re-extract button — shown when retry is available (Task 3) */}
          {extractResult.canRetry && !extracting && (
            <button
              onClick={() => handleExtract(true)}
              disabled={extracting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-950/50 disabled:opacity-50 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Re-extract
            </button>
          )}

          {/* ─── Status feedback (Audit 1, Task 4) ──────────── */}
          {extractResult.status === "success" && (
            <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {extractResult.message}
            </span>
          )}
          {extractResult.status === "warning" && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
              {extractResult.extractionStatus === "in_flight" ? (
                <Clock className="h-3.5 w-3.5" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5" />
              )}
              {extractResult.message}
            </span>
          )}
          {extractResult.status === "error" && (
            <span className="inline-flex items-center gap-1 text-xs text-destructive">
              <XCircle className="h-3.5 w-3.5" />
              {extractResult.message}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
