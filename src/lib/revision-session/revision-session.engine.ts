/**
 * Revision Session Engine — pure functions.
 *
 * A revision session is a bounded, question-based pass over the concepts
 * that are due today. This module decides, without any I/O:
 *   - whether a concept was already handled since the session's start-of-day
 *     (so a refresh or a mid-session exit resumes instead of repeating)
 *   - which question to ask (via the reinforcement engine's unseen-first pick)
 *   - how to describe the schedule SM-2 produced ("back tomorrow")
 *   - how to summarize a finished session
 *
 * It never schedules anything itself. SM-2 remains the only scheduler and is
 * reached only through the existing POST /api/revision actions.
 */

import {
  summarizeHistory,
  pickTransferMcq,
  type ReinforcementEvent,
  type ReinforcementMcq,
} from "@/lib/reinforcement/reinforcement.engine";

// ─── Contract ───────────────────────────────────────────────

/** Event types that count as "this concept was handled in this session". */
export const COMPLETING_EVENT_TYPES: readonly string[] = [
  "mcq_attempt",
  "self_assessment",
  "skip",
];

export interface TimedEvent {
  eventType: string;
  createdAt: Date | string;
}

/** What the student did with one concept in the session. */
export type SessionOutcome =
  | "correct"
  | "wrong"
  | "remembered"
  | "partially"
  | "forgot"
  | "skipped";

export interface SessionResult {
  conceptId: string;
  conceptName: string;
  outcome: SessionOutcome;
  /** Days until SM-2 brings it back, when the API reported it. */
  intervalDays: number | null;
  /** Whether a repair ran for this concept. */
  repaired: boolean;
  /** Mark out of 10 when the item was a written answer. */
  score?: number;
}

export interface SessionSummary {
  total: number;
  answered: number;
  correct: number;
  wrong: number;
  remembered: number;
  partially: number;
  forgot: number;
  skipped: number;
  repaired: number;
  /** Simple retention signal for the session: (correct + remembered) / answered. */
  retentionRate: number | null;
}

// ─── Recovery ───────────────────────────────────────────────

function toTime(d: Date | string): number {
  return d instanceof Date ? d.getTime() : new Date(d).getTime();
}

/**
 * True when the student already answered, self-assessed or skipped this
 * concept at or after `since`. Used to resume a session after a refresh or
 * an exit without asking the same concept twice in a day.
 */
export function isCompletedSince(events: TimedEvent[], since: Date): boolean {
  const cutoff = since.getTime();
  if (Number.isNaN(cutoff)) return false;
  return events.some(
    (e) => COMPLETING_EVENT_TYPES.includes(e.eventType) && toTime(e.createdAt) >= cutoff,
  );
}

// ─── Question selection ─────────────────────────────────────

/**
 * The question to ask for a due concept: an MCQ from its existing inventory
 * that the student has not attempted, else the least-recently relevant one,
 * else null (the session falls back to recall-then-reveal for that concept).
 */
export function selectSessionQuestion(
  rawMcqs: unknown[],
  history: ReinforcementEvent[],
): ReinforcementMcq | null {
  return pickTransferMcq(rawMcqs, summarizeHistory(history));
}

// ─── Mains question selection ───────────────────────────────

export interface RevisionSessionMains {
  question: string;
  guidancePoints: string[];
  estimatedMarks: number;
}

/** First well-formed Mains question in a JSONB inventory, or null. */
export function pickMains(raw: unknown): RevisionSessionMains | null {
  if (!Array.isArray(raw)) return null;
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const r = m as Record<string, unknown>;
    if (typeof r.question !== "string" || r.question.trim().length < 10) continue;
    return {
      question: r.question,
      guidancePoints: Array.isArray(r.guidancePoints) ? r.guidancePoints.filter((g): g is string => typeof g === "string") : [],
      estimatedMarks: typeof r.estimatedMarks === "number" ? r.estimatedMarks : 10,
    };
  }
  return null;
}

// ─── Schedule feedback ──────────────────────────────────────

/** Human wording for an SM-2 interval, shown right after an answer. */
export function scheduleLabel(intervalDays: number | null | undefined): string {
  if (intervalDays === null || intervalDays === undefined || !Number.isFinite(intervalDays)) {
    return "Scheduled for revision";
  }
  if (intervalDays <= 0) return "Back today";
  if (intervalDays === 1) return "Back tomorrow";
  if (intervalDays < 7) return `Back in ${intervalDays} days`;
  if (intervalDays < 14) return "Back in about a week";
  if (intervalDays < 30) return `Back in about ${Math.round(intervalDays / 7)} weeks`;
  return `Back in about ${Math.round(intervalDays / 30)} month${intervalDays >= 45 ? "s" : ""}`;
}

// ─── Summary ────────────────────────────────────────────────

export function summarizeSession(results: SessionResult[]): SessionSummary {
  const s: SessionSummary = {
    total: results.length,
    answered: 0,
    correct: 0,
    wrong: 0,
    remembered: 0,
    partially: 0,
    forgot: 0,
    skipped: 0,
    repaired: 0,
    retentionRate: null,
  };

  for (const r of results) {
    if (r.repaired) s.repaired++;
    switch (r.outcome) {
      case "correct": s.correct++; s.answered++; break;
      case "wrong": s.wrong++; s.answered++; break;
      case "remembered": s.remembered++; s.answered++; break;
      case "partially": s.partially++; s.answered++; break;
      case "forgot": s.forgot++; s.answered++; break;
      case "skipped": s.skipped++; break;
    }
  }

  if (s.answered > 0) {
    s.retentionRate = Math.round(((s.correct + s.remembered) / s.answered) * 100) / 100;
  }

  return s;
}
