"use client";

/**
 * VoiceAnswer — answer an interview prompt aloud.
 *
 * Record (≤ 3 min) → listen back → submit → Whisper transcript + measured
 * delivery (pace, fillers, pauses, length) + board-style evaluation.
 * Falls back to a typed answer when no microphone is available.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import type { InterviewResponse } from "@/lib/answer/interview";

const MAX_SECONDS = 180;

export interface VoiceAnswerProps {
  conceptId: string;
  prompt: string;
  dimensions: string[];
  onEvaluated?: (result: InterviewResponse, source: "voice" | "typed") => void;
  idPrefix?: string;
}

type Stage = "idle" | "recording" | "recorded" | "typing" | "submitting" | "done";

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const RATING_TONE: Record<string, string> = {
  strong: "text-green-700 dark:text-green-300",
  adequate: "text-foreground",
  weak: "text-amber-700 dark:text-amber-300",
  missing: "text-red-700 dark:text-red-300",
};

export function VoiceAnswer({ conceptId, prompt, dimensions, onEvaluated, idPrefix = "voice" }: VoiceAnswerProps) {
  const [stage, setStage] = useState<Stage>("idle");
  const [seconds, setSeconds] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InterviewResponse | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const timerRef = useRef<number | null>(null);

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => () => {
    stopTracks();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  const start = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Recording is not supported in this browser. Type your answer instead.");
      setStage("typing");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32_000 } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || mimeType || "audio/webm" });
        blobRef.current = blob;
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioUrl(URL.createObjectURL(blob));
        setStage("recorded");
        stopTracks();
      };
      recorderRef.current = rec;
      rec.start(1000);
      setSeconds(0);
      setStage("recording");
      const startedAt = Date.now();
      timerRef.current = window.setInterval(() => {
        const s = (Date.now() - startedAt) / 1000;
        setSeconds(s);
        if (s >= MAX_SECONDS && rec.state === "recording") rec.stop();
      }, 250);
    } catch (err) {
      const denied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
      setError(denied ? "Microphone access was blocked. Allow it in the browser, or type your answer instead." : "No microphone was found. Type your answer instead.");
      setStage("typing");
    }
  };

  const stop = () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  const submit = async (source: "voice" | "typed") => {
    setError(null);
    setStage("submitting");
    try {
      const form = new FormData();
      form.append("conceptId", conceptId);
      form.append("prompt", prompt);
      form.append("dimensions", JSON.stringify(dimensions));
      if (source === "voice" && blobRef.current) form.append("audio", blobRef.current, "answer");
      else form.append("transcript", typed.trim());
      const res = await fetch("/api/answer/interview", { method: "POST", body: form });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error?.message || "Evaluation failed. Please try again.");
      const data = json.data as InterviewResponse;
      setResult(data);
      setStage("done");
      onEvaluated?.(data, source);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluation failed. Please try again.");
      setStage(source === "voice" ? "recorded" : "typing");
    }
  };

  return (
    <div className="space-y-2.5">
      {stage === "idle" && (
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={start} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90" id={`${idPrefix}-record`}>
            <Mic className="h-3.5 w-3.5" /> Record answer
          </button>
          <button onClick={() => setStage("typing")} className="text-xs text-muted-foreground hover:text-foreground" id={`${idPrefix}-type`}>
            Type instead
          </button>
          <span className="text-[11px] text-muted-foreground">Aim for 60–120 seconds, as in the board.</span>
        </div>
      )}

      {stage === "recording" && (
        <div className="flex items-center gap-3 rounded-md border border-red-600/40 px-3 py-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" />
          <span className="text-xs font-medium tabular-nums">{mmss(seconds)} / {mmss(MAX_SECONDS)}</span>
          <span className={cn("text-[11px] text-muted-foreground", seconds > 120 && "text-amber-700 dark:text-amber-300")}>
            {seconds < 30 ? "Recording" : seconds <= 120 ? "Good length" : "Getting long — wrap up"}
          </span>
          <button onClick={stop} className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted/60" id={`${idPrefix}-stop`}>
            <Square className="h-3 w-3" /> Stop
          </button>
        </div>
      )}

      {(stage === "recorded" || (stage === "submitting" && audioUrl && !typed)) && audioUrl && (
        <div className="space-y-2">
          <audio src={audioUrl} controls className="h-9 w-full" id={`${idPrefix}-playback`} />
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => submit("voice")} disabled={stage === "submitting"} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40" id={`${idPrefix}-submit`}>
              {stage === "submitting" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Transcribing and evaluating…</> : "Submit for evaluation"}
            </button>
            <button onClick={() => { setStage("idle"); setAudioUrl(null); blobRef.current = null; }} disabled={stage === "submitting"} className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40" id={`${idPrefix}-again`}>
              Record again
            </button>
          </div>
        </div>
      )}

      {(stage === "typing" || (stage === "submitting" && !!typed)) && (
        <div className="space-y-2">
          <Textarea value={typed} onChange={(e) => setTyped(e.target.value)} rows={5} placeholder="Write the answer as you would say it to the board." className="text-sm" disabled={stage === "submitting"} id={`${idPrefix}-text`} />
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => submit("typed")} disabled={stage === "submitting" || typed.trim().split(/\s+/).length < 8} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40" id={`${idPrefix}-submit-typed`}>
              {stage === "submitting" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Evaluating…</> : "Submit for evaluation"}
            </button>
            <button onClick={() => { setStage("idle"); setError(null); }} disabled={stage === "submitting"} className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40">
              Record instead
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-[11px] text-red-700 dark:text-red-300">{error}</p>}

      {result && <InterviewResult result={result} idPrefix={idPrefix} />}
    </div>
  );
}

function InterviewResult({ result, idPrefix }: { result: InterviewResponse; idPrefix: string }) {
  const { evaluation: e, delivery: d } = result;
  const tone = e.score >= 7 ? "text-green-700 dark:text-green-300" : e.score >= 5 ? "text-foreground" : "text-red-700 dark:text-red-300";
  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 px-3 py-3" id={`${idPrefix}-result`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Board evaluation</p>
        <p className={cn("text-sm font-semibold", tone)}>{e.score} / 10 <span className="ml-1 text-xs font-medium capitalize text-muted-foreground">{e.verdict.replace("_", " ")}</span></p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
        <Metric label="Length" value={`${mmss(d.durationSeconds)}`} note={d.lengthLabel} />
        <Metric label="Pace" value={`${d.wordsPerMinute} wpm`} note={d.paceLabel} />
        <Metric label="Fillers" value={String(d.fillerCount)} note={d.topFillers.length ? d.topFillers.map((f) => `${f.filler} ×${f.count}`).join(", ") : "none"} />
        <Metric label="Long pauses" value={String(d.longPauses)} note="≥ 3 seconds" />
      </div>

      {e.dimensions.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Dimensions</p>
          <ul className="space-y-1">
            {e.dimensions.map((dim, i) => (
              <li key={i} className="text-xs leading-relaxed">
                <span className="font-medium">{dim.name}</span>
                <span className={cn("ml-1.5 text-[11px] font-medium capitalize", RATING_TONE[dim.rating])}>{dim.rating}</span>
                {dim.comment && <span className="text-muted-foreground"> — {dim.comment}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Points title="Strengths" items={e.strengths} />
      <Points title="Gaps" items={e.gaps} />
      <Points title="Inaccuracies" items={e.inaccuracies} />
      {e.balance && <Line title="Balance" text={e.balance} />}
      {e.delivery && <Line title="Delivery" text={e.delivery} />}
      {e.followUp && (
        <div className="rounded border border-border bg-background px-2.5 py-2">
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Likely follow-up from the board</p>
          <p className="text-xs font-medium leading-relaxed">{e.followUp}</p>
        </div>
      )}
      <Points title="A stronger answer would" items={e.strongerAnswer} />
      <Line title="Next attempt" text={e.improvement} />

      <details className="text-xs">
        <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">Transcript</summary>
        <p className="mt-1.5 whitespace-pre-wrap rounded border border-border/60 bg-background px-2.5 py-2 leading-relaxed text-muted-foreground">{result.transcript}</p>
      </details>
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded border border-border/60 bg-background px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
      <p className="truncate text-[10px] text-muted-foreground">{note}</p>
    </div>
  );
}

function Line({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      <p className="text-xs leading-relaxed">{text}</p>
    </div>
  );
}

function Points({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
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
