/**
 * Revision Session Engine Validation
 *
 * Deterministic tests for the pure helpers behind the question-based
 * revision session.
 *
 * Tests:
 *   Section 1: Resume — isCompletedSince
 *   Section 2: Question selection delegates to unseen-first picking
 *   Section 3: Schedule wording
 *   Section 4: Session summary
 *   Section 5: Isolation — no SM-2 mutation, no legacy R2, no AI, no DB
 *
 * Run: npx tsx src/lib/revision-session/__tests__/revision-session-engine.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isCompletedSince,
  selectSessionQuestion,
  scheduleLabel,
  summarizeSession,
  COMPLETING_EVENT_TYPES,
} from "@/lib/revision-session/revision-session.engine";
import type { SessionResult } from "@/lib/revision-session/revision-session.engine";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string): void {
  if (condition) passed++;
  else {
    failed++;
    failures.push(label);
    console.error(`  ✗ FAIL: ${label}`);
  }
}

function section(title: string): void {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 55 - title.length))}`);
}

const T0 = new Date("2026-11-11T00:00:00+05:30"); // local midnight, IST
const before = new Date(T0.getTime() - 60_000);
const after = new Date(T0.getTime() + 60_000);

// ─── Section 1 ──────────────────────────────────────────────

section("Section 1: Resume — isCompletedSince");
{
  assert(isCompletedSince([], T0) === false, "1a: no events → not completed");
  assert(isCompletedSince([{ eventType: "mcq_attempt", createdAt: after }], T0), "1b: MCQ attempt after cutoff → completed");
  assert(isCompletedSince([{ eventType: "self_assessment", createdAt: after }], T0), "1c: self-assessment after cutoff → completed");
  assert(isCompletedSince([{ eventType: "skip", createdAt: after }], T0), "1d: skip after cutoff → completed");
  assert(isCompletedSince([{ eventType: "mcq_attempt", createdAt: before }], T0) === false, "1e: attempt before cutoff → not completed");
  assert(isCompletedSince([{ eventType: "repair_verification", createdAt: after }], T0) === false, "1f: a repair event alone does not complete a concept");
  assert(isCompletedSince([{ eventType: "mcq_attempt", createdAt: after.toISOString() }], T0), "1g: ISO string timestamps accepted");
  assert(isCompletedSince([{ eventType: "mcq_attempt", createdAt: T0 }], T0), "1h: event exactly at cutoff counts");
  assert(isCompletedSince([{ eventType: "mcq_attempt", createdAt: after }], new Date("garbage")) === false, "1i: invalid cutoff → never completed (fail open to asking)");
  assert(COMPLETING_EVENT_TYPES.length === 3, "1j: exactly three completing event types");
}

// ─── Section 2 ──────────────────────────────────────────────

section("Section 2: Question selection");
{
  const mcq = (i: number) => ({
    questionId: `q${i}`,
    question: `Q${i}?`,
    options: { a: "A", b: "B", c: "C", d: "D" },
    correctAnswer: "c",
    explanation: "",
  });
  const inv = [mcq(0), mcq(1)];

  const fresh = selectSessionQuestion(inv, []);
  assert(fresh?.questionId === "q0", "2a: no history → first question");

  const seenQ0 = selectSessionQuestion(inv, [
    { eventType: "mcq_attempt", mcqQuestionIndex: 0, eventMetadata: { questionId: "q0" } },
  ]);
  assert(seenQ0?.questionId === "q1", "2b: attempted question skipped → unseen one asked");

  const allSeen = selectSessionQuestion(inv, [
    { eventType: "mcq_attempt", mcqQuestionIndex: 0, eventMetadata: { questionId: "q0" } },
    { eventType: "mcq_attempt", mcqQuestionIndex: 1, eventMetadata: { questionId: "q1" } },
  ]);
  assert(allSeen?.questionId === "q0", "2c: everything seen → still asks (falls back to first)");

  assert(selectSessionQuestion([], []) === null, "2d: no inventory → null → recall fallback");
  assert(selectSessionQuestion(["junk", 42], []) === null, "2e: malformed inventory → null");
}

// ─── Section 3 ──────────────────────────────────────────────

section("Section 3: Schedule wording");
{
  assert(scheduleLabel(null) === "Scheduled for revision", "3a: null → generic");
  assert(scheduleLabel(undefined) === "Scheduled for revision", "3b: undefined → generic");
  assert(scheduleLabel(0) === "Back today", "3c: 0 → today");
  assert(scheduleLabel(1) === "Back tomorrow", "3d: 1 → tomorrow");
  assert(scheduleLabel(3) === "Back in 3 days", "3e: 3 → days");
  assert(scheduleLabel(8) === "Back in about a week", "3f: 8 → about a week");
  assert(scheduleLabel(21) === "Back in about 3 weeks", "3g: 21 → weeks");
  assert(scheduleLabel(30) === "Back in about 1 month", "3h: 30 → 1 month (singular)");
  assert(scheduleLabel(90) === "Back in about 3 months", "3i: 90 → months");
  assert(scheduleLabel(Number.NaN) === "Scheduled for revision", "3j: NaN → generic");
}

// ─── Section 4 ──────────────────────────────────────────────

section("Section 4: Session summary");
{
  const r = (outcome: SessionResult["outcome"], repaired = false): SessionResult => ({
    conceptId: outcome, conceptName: outcome, outcome, intervalDays: 1, repaired,
  });

  const empty = summarizeSession([]);
  assert(empty.total === 0 && empty.answered === 0 && empty.retentionRate === null, "4a: empty → zeros, null rate");

  const s = summarizeSession([
    r("correct"), r("correct"), r("wrong", true), r("remembered"), r("partially", true), r("forgot", true), r("skipped"),
  ]);
  assert(s.total === 7, "4b: total counts every item");
  assert(s.answered === 6, "4c: skipped is not answered");
  assert(s.correct === 2 && s.wrong === 1, "4d: MCQ outcomes counted");
  assert(s.remembered === 1 && s.partially === 1 && s.forgot === 1, "4e: recall outcomes counted");
  assert(s.skipped === 1, "4f: skipped counted");
  assert(s.repaired === 3, "4g: repaired counted independently of outcome");
  assert(s.retentionRate === 0.5, "4h: retention = (correct + remembered) / answered = 3/6");

  const allSkipped = summarizeSession([r("skipped"), r("skipped")]);
  assert(allSkipped.retentionRate === null, "4i: nothing answered → null rate, no divide-by-zero");
}

// ─── Section 5 ──────────────────────────────────────────────

section("Section 5: Isolation");
{
  const engine = readFileSync(join(process.cwd(), "src/lib/revision-session/revision-session.engine.ts"), "utf8");
  for (const token of ["lib/diagnostic", "spaced-repetition", "revision-intelligence", "@/lib/ai/client", "@/lib/db", "repositories", "fetch(", "upsertMastery", "logEvent"]) {
    assert(!engine.includes(token), `5a: engine does not reference "${token}"`);
  }
  const importStatements = engine.match(/^\s*import\b/gm) ?? [];
  assert(
    importStatements.length === 1 && engine.includes('from "@/lib/reinforcement/reinforcement.engine"'),
    "5b: engine's only import is the reinforcement engine (pure → pure)",
  );

  const service = readFileSync(join(process.cwd(), "src/lib/revision-session/revision-session.service.ts"), "utf8");
  for (const token of ["lib/diagnostic", "spaced-repetition.engine", "@/lib/ai/client", "upsertMastery", "recordReview", "logEvent("]) {
    assert(!service.includes(token), `5c: service does not reference "${token}"`);
  }
  assert(service.includes("getRecommendations"), "5d: service reuses the existing revision recommendations (no second scheduler)");
  console.log("  ✓ Read-only assembly: SM-2 reached only through existing POST routes");
}

// ─── Summary ────────────────────────────────────────────────

section("RESULTS");
console.log(`\n  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
if (failures.length > 0) {
  console.log(`\n  Failures:`);
  failures.forEach((f) => console.log(`    - ${f}`));
}
console.log(`\n  ${failed === 0 ? "✅ REVISION SESSION ENGINE: VALIDATED" : "❌ REVISION SESSION ENGINE: ISSUES FOUND"}\n`);
process.exit(failed > 0 ? 1 : 0);
