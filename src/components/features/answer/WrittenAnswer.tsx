"use client";

/**
 * WrittenAnswer — write an answer (typed, or on paper and photographed) and
 * have it marked against the reference.
 *
 * Photos are downscaled in the browser (long side ≤ 1600 px, JPEG) before
 * upload, so a phone photo of a handwritten page stays well under the vision
 * model's limit. The server transcribes photos, then marks the combined text.
 *
 * One submission per mount: the student gets a mark, not unlimited retries.
 */

import { useRef, useState } from "react";
import { Loader2, Paperclip, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import type { AnswerMode, EvaluateResponse } from "@/lib/answer/answer-evaluation";

/** Mirrors wordTarget() in answer-evaluation.ts (kept local to avoid shipping zod to the client). */
function wordTarget(mode: AnswerMode, question: string, marks?: number): number {
  const stated = question.match(/\((\d{2,4})\s*words?\)/i);
  if (stated) {
    const n = Number(stated[1]);
    if (n >= 20 && n <= 1000) return n;
  }
  if (mode === "mains") return marks && marks >= 15 ? 250 : 150;
  return 100;
}

const MAX_IMAGES = 3;
const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.85;

export interface WrittenAnswerProps {
  conceptId: string;
  mode: AnswerMode;
  question: string;
  reference?: string | string[];
  marks?: number;
  /** Called once the answer has been marked. */
  onEvaluated?: (result: EvaluateResponse) => void;
  /** Optional secondary action, e.g. "I can't recall it — show the answer". */
  skipLabel?: string;
  onSkip?: () => void;
  submitLabel?: string;
  idPrefix?: string;
}

const VERDICT_LABEL: Record<string, string> = {
  excellent: "Excellent",
  good: "Good",
  partial: "Partial",
  weak: "Weak",
  off_topic: "Off topic",
};

async function downscale(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Could not read that image."));
      i.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not process that image.");
    ctx.fillStyle = "#ffffff"; // flatten transparency onto paper-white
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

export function WrittenAnswer({
  conceptId,
  mode,
  question,
  reference,
  marks,
  onEvaluated,
  skipLabel,
  onSkip,
  submitLabel = "Submit for evaluation",
  idPrefix = "written",
}: WrittenAnswerProps) {
  const [typed, setTyped] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState<"idle" | "processing" | "evaluating">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EvaluateResponse | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const wordLimit = wordTarget(mode, question, marks);
  const words = wordCount(typed);
  const canSubmit = busy === "idle" && !result && (typed.trim().length >= 5 || images.length > 0);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    const room = MAX_IMAGES - images.length;
    const picked = Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, room);
    if (picked.length === 0) {
      setError(room <= 0 ? `Up to ${MAX_IMAGES} pages.` : "Choose an image file (photo of your answer).");
      return;
    }
    setBusy("processing");
    try {
      const urls = await Promise.all(picked.map(downscale));
      setImages((prev) => [...prev, ...urls].slice(0, MAX_IMAGES));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that image.");
    } finally {
      setBusy("idle");
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy("evaluating");
    setError(null);
    try {
      const res = await fetch("/api/answer/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conceptId,
          mode,
          question,
          ...(typed.trim() ? { typedAnswer: typed.trim() } : {}),
          ...(images.length ? { images } : {}),
          ...(reference && (Array.isArray(reference) ? reference.length : reference.trim()) ? { reference } : {}),
          ...(marks ? { marks } : {}),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error?.message || "Evaluation failed. Please try again.");
      const data = json.data as EvaluateResponse;
      setResult(data);
      onEvaluated?.(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluation failed. Please try again.");
    } finally {
      setBusy("idle");
    }
  };

  return (
    <div className="space-y-2.5">
      {!result && (
        <>
          <Textarea
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={mode === "mains" ? `Write your answer (about ${wordLimit} words), or attach a photo of it written on paper.` : "Write your answer from memory, or attach a photo of it written on paper."}
            rows={mode === "mains" ? 8 : 4}
            disabled={busy === "evaluating"}
            className="text-sm leading-relaxed"
            id={`${idPrefix}-text`}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className={cn(words > wordLimit * 1.2 && "text-amber-700 dark:text-amber-300")}>
              {words} / ~{wordLimit} words
            </span>
            <div className="flex items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
                id={`${idPrefix}-file`}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy !== "idle" || images.length >= MAX_IMAGES}
                className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline disabled:opacity-40"
                id={`${idPrefix}-attach`}
              >
                <Paperclip className="h-3.5 w-3.5" />
                Attach photo of written answer
              </button>
            </div>
          </div>

          {images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {images.map((src, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`Answer page ${i + 1}`} className="h-20 w-16 rounded border border-border object-cover" />
                  <button
                    type="button"
                    onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                    disabled={busy === "evaluating"}
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground"
                    aria-label={`Remove page ${i + 1}`}
                    id={`${idPrefix}-remove-${i}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <span className="absolute bottom-0.5 left-0.5 rounded bg-background/90 px-1 text-[9px] text-muted-foreground">p{i + 1}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
              id={`${idPrefix}-submit`}
            >
              {busy === "evaluating" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {images.length ? "Reading and evaluating…" : "Evaluating…"}
                </>
              ) : busy === "processing" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Preparing photo…
                </>
              ) : (
                submitLabel
              )}
            </button>
            {skipLabel && onSkip && (
              <button type="button" onClick={onSkip} disabled={busy === "evaluating"} className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40" id={`${idPrefix}-skip`}>
                {skipLabel}
              </button>
            )}
          </div>
        </>
      )}

      {error && <p className="text-[11px] text-red-700 dark:text-red-300">{error}</p>}

      {result && <EvaluationView result={result} idPrefix={idPrefix} />}
    </div>
  );
}

function EvaluationView({ result, idPrefix }: { result: EvaluateResponse; idPrefix: string }) {
  const { evaluation: e } = result;
  const tone = e.score >= 7 ? "text-green-700 dark:text-green-300" : e.score >= 5 ? "text-foreground" : "text-red-700 dark:text-red-300";
  return (
    <div className="space-y-2.5 rounded-md border border-border bg-muted/30 px-3 py-3" id={`${idPrefix}-result`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Evaluation</p>
        <p className={cn("text-sm font-semibold", tone)}>
          {e.score} / 10 <span className="ml-1 text-xs font-medium text-muted-foreground">{VERDICT_LABEL[e.verdict] ?? e.verdict}</span>
        </p>
      </div>
      <PointList title="Covered" items={e.covered} />
      <PointList title="Missed" items={e.missed} />
      <PointList title="Inaccuracies" items={e.inaccuracies} />
      {e.structure && (
        <div>
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Structure</p>
          <p className="text-xs leading-relaxed">{e.structure}</p>
        </div>
      )}
      <div>
        <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">To improve</p>
        <p className="text-xs leading-relaxed">{e.improvement}</p>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
          {result.transcription !== null ? "What was read from your photo" : "Your answer"}
        </summary>
        <p className="mt-1.5 whitespace-pre-wrap rounded border border-border/60 bg-background px-2.5 py-2 leading-relaxed text-muted-foreground">{result.answerText}</p>
      </details>
    </div>
  );
}

function PointList({ title, items }: { title: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      <ul className="space-y-0.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-1.5 text-xs leading-relaxed">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
