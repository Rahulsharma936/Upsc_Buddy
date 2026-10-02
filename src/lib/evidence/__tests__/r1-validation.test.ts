/**
 * R1.5 Evidence Foundation Validation
 *
 * Tests all 10 evidence scenarios + SM-2 regression using
 * the actual pure functions from the codebase.
 *
 * Run: npx tsx src/lib/evidence/__tests__/r1-validation.test.ts
 */

import {
  calculateNextState,
  initializeMastery,
  handleSkip,
  estimateForgettingProbability,
  type MasteryState,
} from "@/lib/ai/services/spaced-repetition.engine";

import { normalizeEvent, normalizeEvents } from "@/lib/evidence/evidence.normalizer";
import type { NormalizedEvidence } from "@/lib/evidence/evidence.types";
import type { RevisionEventRecord } from "@/types/database.types";

// ─── Test Helpers ─────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    console.error(`  ✗ FAIL: ${label}`);
  }
}

function section(title: string): void {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 55 - title.length))}`);
}

/** Create a synthetic RevisionEventRecord for testing. */
function makeEvent(overrides: Partial<RevisionEventRecord> & {
  eventType: string;
}): RevisionEventRecord {
  return {
    id: crypto.randomUUID(),
    userId: "user-001",
    conceptId: "concept-001",
    eventType: overrides.eventType,
    qualityRating: overrides.qualityRating ?? null,
    mcqCorrect: overrides.mcqCorrect ?? null,
    mcqQuestionIndex: overrides.mcqQuestionIndex ?? null,
    eventMetadata: overrides.eventMetadata ?? {},
    createdAt: overrides.createdAt ?? new Date(),
  };
}

// ─── Scenario 1: MCQ correct → later MCQ incorrect ─────────

section("Scenario 1: MCQ correct → later incorrect");

{
  const t1 = new Date("2026-07-01T10:00:00Z");
  const t2 = new Date("2026-07-05T10:00:00Z");

  const e1 = makeEvent({
    eventType: "mcq_attempt",
    qualityRating: 4,
    mcqCorrect: true,
    mcqQuestionIndex: 0,
    eventMetadata: {
      questionId: "q-001",
      selectedAnswer: "b",
      correctAnswer: "b",
      confidence: 3,
      previousInterval: 1,
      newInterval: 1,
      previousEase: 2.5,
      newEase: 2.5,
    },
    createdAt: t1,
  });

  const e2 = makeEvent({
    eventType: "mcq_attempt",
    qualityRating: 1,
    mcqCorrect: false,
    mcqQuestionIndex: 1,
    eventMetadata: {
      questionId: "q-002",
      selectedAnswer: "a",
      correctAnswer: "c",
      confidence: 2,
      previousInterval: 3,
      newInterval: 1,
      previousEase: 2.5,
      newEase: 2.35,
    },
    createdAt: t2,
  });

  const [n1, n2] = normalizeEvents([e1, e2]);

  assert(n1.eventType === "mcq_attempt", "S1: e1 eventType");
  assert(n1.mcqCorrect === true, "S1: e1 correct");
  assert(n1.confidence === 3, "S1: e1 confidence");
  assert(n1.questionId === "q-001", "S1: e1 questionId");
  assert(n1.selectedAnswer === "b", "S1: e1 selectedAnswer");

  assert(n2.eventType === "mcq_attempt", "S1: e2 eventType");
  assert(n2.mcqCorrect === false, "S1: e2 incorrect");
  assert(n2.confidence === 2, "S1: e2 confidence");
  assert(n2.questionId === "q-002", "S1: e2 questionId");
  assert(n2.selectedAnswer === "a", "S1: e2 selectedAnswer");
  assert(n2.correctAnswer === "c", "S1: e2 correctAnswer");

  // Chronological order preserved
  assert(n1.timestamp < n2.timestamp, "S1: chronological order");

  // SM-2: correct→4 then incorrect→1
  const state0 = initializeMastery();
  const after1 = calculateNextState(state0, 4);
  assert(after1.nextState.correctCount === 1, "S1: SM-2 correct incremented");
  assert(after1.nextState.repetitionCount === 1, "S1: SM-2 reps incremented");

  const after2 = calculateNextState(after1.nextState, 1);
  assert(after2.nextState.incorrectCount === 1, "S1: SM-2 incorrect incremented");
  assert(after2.nextState.repetitionCount === 0, "S1: SM-2 reps reset to 0");
  assert(after2.intervalDays === 1, "S1: SM-2 interval reset to 1");

  console.log("  ✓ Trajectory: correct→incorrect with full evidence");
}

// ─── Scenario 2: MCQ incorrect → later correct ─────────────

section("Scenario 2: MCQ incorrect → later correct");

{
  const state0 = initializeMastery();
  const after1 = calculateNextState(state0, 1); // incorrect
  const after2 = calculateNextState(after1.nextState, 4); // correct

  assert(after1.nextState.incorrectCount === 1, "S2: incorrect first");
  assert(after1.nextState.masteryLevel === "learning", "S2: learning after fail");
  assert(after2.nextState.correctCount === 1, "S2: correct after");
  assert(after2.nextState.repetitionCount === 1, "S2: reps=1 after recovery");

  const e1 = makeEvent({
    eventType: "mcq_attempt", qualityRating: 1, mcqCorrect: false,
    eventMetadata: { selectedAnswer: "a", correctAnswer: "c" },
    createdAt: new Date("2026-07-01"),
  });
  const e2 = makeEvent({
    eventType: "mcq_attempt", qualityRating: 4, mcqCorrect: true,
    eventMetadata: { selectedAnswer: "c", correctAnswer: "c" },
    createdAt: new Date("2026-07-03"),
  });

  const [n1, n2] = normalizeEvents([e1, e2]);
  assert(n1.mcqCorrect === false && n2.mcqCorrect === true, "S2: normalized trajectory");
  console.log("  ✓ Recovery trajectory: incorrect→correct");
}

// ─── Scenario 3: High confidence → incorrect ───────────────

section("Scenario 3: High confidence → incorrect");

{
  const e = makeEvent({
    eventType: "mcq_attempt",
    qualityRating: 1,
    mcqCorrect: false,
    eventMetadata: {
      questionId: "q-003",
      selectedAnswer: "d",
      correctAnswer: "a",
      confidence: 3, // Very sure
    },
  });

  const n = normalizeEvent(e);
  assert(n.confidence === 3, "S3: high confidence captured");
  assert(n.mcqCorrect === false, "S3: still incorrect");
  assert(n.qualityRating === 1, "S3: quality=1 for incorrect");
  assert(n.questionId === "q-003", "S3: questionId preserved");

  // SM-2 should NOT be affected by confidence (only quality)
  const state = initializeMastery();
  const result = calculateNextState(state, 1);
  assert(result.nextState.incorrectCount === 1, "S3: SM-2 unaffected by confidence");

  console.log("  ✓ Calibration gap detectable: confidence=3, mcqCorrect=false");
}

// ─── Scenario 4: Low confidence → correct ──────────────────

section("Scenario 4: Low confidence → correct");

{
  const e = makeEvent({
    eventType: "mcq_attempt",
    qualityRating: 4,
    mcqCorrect: true,
    eventMetadata: {
      questionId: "q-004",
      selectedAnswer: "b",
      correctAnswer: "b",
      confidence: 1, // Guessing
    },
  });

  const n = normalizeEvent(e);
  assert(n.confidence === 1, "S4: low confidence captured");
  assert(n.mcqCorrect === true, "S4: still correct");
  assert(n.qualityRating === 4, "S4: quality=4 for correct");

  console.log("  ✓ Lucky guess detectable: confidence=1, mcqCorrect=true");
}

// ─── Scenario 5: Same questionId attempted multiple times ──

section("Scenario 5: Same questionId multiple attempts");

{
  const qId = "q-stable-001";
  const events = [
    makeEvent({
      eventType: "mcq_attempt", qualityRating: 1, mcqCorrect: false,
      eventMetadata: { questionId: qId, selectedAnswer: "a", correctAnswer: "c", confidence: 2 },
      createdAt: new Date("2026-07-01"),
    }),
    makeEvent({
      eventType: "mcq_attempt", qualityRating: 1, mcqCorrect: false,
      eventMetadata: { questionId: qId, selectedAnswer: "b", correctAnswer: "c", confidence: 1 },
      createdAt: new Date("2026-07-03"),
    }),
    makeEvent({
      eventType: "mcq_attempt", qualityRating: 4, mcqCorrect: true,
      eventMetadata: { questionId: qId, selectedAnswer: "c", correctAnswer: "c", confidence: 3 },
      createdAt: new Date("2026-07-06"),
    }),
  ];

  const normalized = normalizeEvents(events);
  const sameQ = normalized.filter((e) => e.questionId === qId);
  assert(sameQ.length === 3, "S5: 3 events for same questionId");
  assert(sameQ[0].mcqCorrect === false, "S5: first attempt wrong");
  assert(sameQ[1].mcqCorrect === false, "S5: second attempt wrong");
  assert(sameQ[2].mcqCorrect === true, "S5: third attempt correct");
  assert(sameQ[0].selectedAnswer === "a", "S5: different answers tried");
  assert(sameQ[1].selectedAnswer === "b", "S5: different answers tried (2)");
  assert(sameQ[2].selectedAnswer === "c", "S5: finally picked correct");

  console.log("  ✓ Per-question trajectory via stable questionId");
}

// ─── Scenario 6: Revision Remembered → later MCQ result ────

section("Scenario 6: Revision Remembered → later MCQ");

{
  const events = [
    makeEvent({
      eventType: "self_assessment", qualityRating: 4,
      eventMetadata: { selfAssessment: "remembered", previousInterval: 3, newInterval: 8, previousEase: 2.5, newEase: 2.6 },
      createdAt: new Date("2026-07-01"),
    }),
    makeEvent({
      eventType: "mcq_attempt", qualityRating: 1, mcqCorrect: false,
      eventMetadata: { questionId: "q-005", selectedAnswer: "a", correctAnswer: "d", confidence: 2 },
      createdAt: new Date("2026-07-05"),
    }),
  ];

  const [rev, mcq] = normalizeEvents(events);
  assert(rev.eventType === "self_assessment", "S6: revision event type");
  assert(rev.selfAssessment === "remembered", "S6: selfAssessment preserved");
  assert(rev.qualityRating === 4, "S6: quality=4 for remembered");
  assert(rev.newInterval === 8, "S6: interval grew");

  assert(mcq.eventType === "mcq_attempt", "S6: MCQ event type");
  assert(mcq.mcqCorrect === false, "S6: MCQ was incorrect");
  assert(rev.timestamp < mcq.timestamp, "S6: revision before MCQ");

  console.log("  ✓ Cross-check: 'remembered' revision but later MCQ failed");
}

// ─── Scenario 7: Revision Forgot → later MCQ/revision ──────

section("Scenario 7: Revision Forgot → later result");

{
  const events = [
    makeEvent({
      eventType: "self_assessment", qualityRating: 1,
      eventMetadata: { selfAssessment: "forgot", previousInterval: 6, newInterval: 1, previousEase: 2.5, newEase: 2.35 },
      createdAt: new Date("2026-07-01"),
    }),
    makeEvent({
      eventType: "self_assessment", qualityRating: 3,
      eventMetadata: { selfAssessment: "partially", previousInterval: 1, newInterval: 1, previousEase: 2.35, newEase: 2.21 },
      createdAt: new Date("2026-07-02"),
    }),
    makeEvent({
      eventType: "mcq_attempt", qualityRating: 4, mcqCorrect: true,
      eventMetadata: { questionId: "q-006", selectedAnswer: "b", correctAnswer: "b", confidence: 2 },
      createdAt: new Date("2026-07-04"),
    }),
  ];

  const [forgot, partial, mcqOk] = normalizeEvents(events);
  assert(forgot.selfAssessment === "forgot", "S7: forgot captured");
  assert(forgot.qualityRating === 1, "S7: quality=1 for forgot");
  assert(forgot.newInterval === 1, "S7: interval reset");

  assert(partial.selfAssessment === "partially", "S7: partially captured");
  assert(partial.qualityRating === 3, "S7: quality=3 for partially");

  assert(mcqOk.mcqCorrect === true, "S7: later MCQ correct");
  assert(forgot.timestamp < partial.timestamp, "S7: chronological (1)");
  assert(partial.timestamp < mcqOk.timestamp, "S7: chronological (2)");

  console.log("  ✓ Recovery trajectory: forgot→partially→MCQ correct");
}

// ─── Scenario 8: Repeated revision skips ────────────────────

section("Scenario 8: Repeated revision skips");

{
  // Test SM-2 skip handling
  let state = initializeMastery();
  for (let i = 1; i <= 4; i++) {
    const result = handleSkip(state);
    state = result.nextState;
  }
  assert(state.skipCount === 4, "S8: skipCount=4 after 4 skips");
  assert(state.isWeakArea === true, "S8: weak area after ≥3 skips");
  assert(state.weakSignals.includes("repeated_skips"), "S8: weak signal present");

  // Test normalized events
  const events = [1, 2, 3, 4].map((i) =>
    makeEvent({
      eventType: "skip",
      eventMetadata: { skipCount: i },
      createdAt: new Date(`2026-07-0${i}`),
    })
  );

  const normalized = normalizeEvents(events);
  assert(normalized.every((e) => e.eventType === "skip"), "S8: all skip types");
  assert(normalized.every((e) => e.qualityRating === null), "S8: no quality for skips");
  assert(normalized[0].skipCount === 1, "S8: skipCount=1 first");
  assert(normalized[3].skipCount === 4, "S8: skipCount=4 last");

  console.log("  ✓ Repeated skips → weak area + evidence preserved");
}

// ─── Scenario 9: Legacy event without R1 fields ─────────────

section("Scenario 9: Legacy event (no R1.2/R1.3 fields)");

{
  // Simulate a pre-R1 event — only top-level columns, minimal metadata
  const legacy = makeEvent({
    eventType: "mcq_attempt",
    qualityRating: 4,
    mcqCorrect: true,
    mcqQuestionIndex: 2,
    eventMetadata: {
      previousInterval: 1,
      newInterval: 3,
      previousEase: 2.5,
      newEase: 2.6,
      // NO questionId, selectedAnswer, correctAnswer, confidence, selfAssessment
    },
  });

  const n = normalizeEvent(legacy);
  assert(n.eventType === "mcq_attempt", "S9: eventType preserved");
  assert(n.mcqCorrect === true, "S9: mcqCorrect from top-level");
  assert(n.mcqQuestionIndex === 2, "S9: index preserved");
  assert(n.qualityRating === 4, "S9: quality preserved");

  // R1.2/R1.3 fields should be null, not undefined or error
  assert(n.questionId === null, "S9: questionId null for legacy");
  assert(n.selectedAnswer === null, "S9: selectedAnswer null for legacy");
  assert(n.correctAnswer === null, "S9: correctAnswer null for legacy");
  assert(n.confidence === null, "S9: confidence null for legacy");
  assert(n.selfAssessment === null, "S9: selfAssessment null for legacy");

  // Mastery transition metadata should still work
  assert(n.previousInterval === 1, "S9: previousInterval present");
  assert(n.newInterval === 3, "S9: newInterval present");

  console.log("  ✓ Legacy events normalize safely — missing fields are null");
}

// ─── Scenario 10: Unknown event type ────────────────────────

section("Scenario 10: Unknown event type");

{
  const weird = makeEvent({
    eventType: "future_quiz_v2",
    qualityRating: 3,
    eventMetadata: { someNewField: "value" },
  });

  const n = normalizeEvent(weird);
  assert(n.eventType === "unknown", "S10: unknown event type");
  assert(n.rawEventType === "future_quiz_v2", "S10: raw event type preserved");
  assert(n.qualityRating === 3, "S10: quality still readable");

  // Verify other known types are NOT mapped to unknown
  const known = makeEvent({ eventType: "review", qualityRating: 4 });
  const nk = normalizeEvent(known);
  assert(nk.eventType === "review", "S10: known 'review' stays 'review'");
  assert(nk.rawEventType === "review", "S10: rawEventType matches");

  const initEvt = makeEvent({ eventType: "initialize" });
  assert(normalizeEvent(initEvt).eventType === "initialize", "S10: 'initialize' stays");

  console.log("  ✓ Unknown types → 'unknown' with rawEventType preserved");
}

// ─── SM-2 Regression Tests ──────────────────────────────────

section("SM-2 Engine Regression");

{
  // Fresh mastery
  const m0 = initializeMastery();
  assert(m0.easeFactor === 2.5, "SM2: initial ease=2.5");
  assert(m0.intervalDays === 1, "SM2: initial interval=1");
  assert(m0.repetitionCount === 0, "SM2: initial reps=0");
  assert(m0.masteryLevel === "unseen", "SM2: initial level=unseen");
  assert(m0.correctCount === 0, "SM2: initial correct=0");
  assert(m0.incorrectCount === 0, "SM2: initial incorrect=0");
  assert(m0.skipCount === 0, "SM2: initial skip=0");
  assert(m0.isWeakArea === false, "SM2: initial not weak");

  // Perfect recall chain: 5 consecutive quality=5
  let state = m0;
  const intervals: number[] = [];
  for (let i = 0; i < 5; i++) {
    const r = calculateNextState(state, 5);
    state = r.nextState;
    intervals.push(r.intervalDays);
  }
  assert(state.correctCount === 5, "SM2: 5 correct after 5 q=5");
  assert(state.incorrectCount === 0, "SM2: 0 incorrect");
  assert(state.repetitionCount === 5, "SM2: 5 reps");
  assert(state.easeFactor > 2.5, "SM2: ease increased after perfect");
  assert(intervals[0] === 1, "SM2: first interval=1");
  assert(intervals[1] === 3, "SM2: second interval=3");
  assert(intervals[2] > 3, "SM2: intervals grow");
  assert(state.masteryLevel === "mastered" || state.masteryLevel === "reviewing",
    "SM2: mastered or reviewing after 5 perfect");

  // Failure resets reps
  const failResult = calculateNextState(state, 1);
  assert(failResult.nextState.repetitionCount === 0, "SM2: reps reset on failure");
  assert(failResult.intervalDays === 1, "SM2: interval=1 on failure");
  assert(failResult.nextState.incorrectCount === 1, "SM2: incorrect incremented");
  assert(failResult.nextState.correctCount === 5, "SM2: correct preserved");
  assert(failResult.nextState.easeFactor < state.easeFactor, "SM2: ease decreased");
  assert(failResult.nextState.easeFactor >= 1.3, "SM2: ease ≥ floor 1.3");

  // Quality=3 (pass threshold) — should succeed
  const q3state = initializeMastery();
  const q3result = calculateNextState(q3state, 3);
  assert(q3result.nextState.correctCount === 1, "SM2: q=3 counts as correct");
  assert(q3result.nextState.repetitionCount === 1, "SM2: q=3 increments reps");

  // Quality=2 (below threshold) — should fail
  const q2state = initializeMastery();
  const q2result = calculateNextState(q2state, 2);
  assert(q2result.nextState.incorrectCount === 1, "SM2: q=2 counts as incorrect");
  assert(q2result.nextState.repetitionCount === 0, "SM2: q=2 resets reps");

  // Mastery classification
  assert(initializeMastery().masteryLevel === "unseen", "SM2: unseen initially");
  const after_fail = calculateNextState(initializeMastery(), 1);
  assert(after_fail.nextState.masteryLevel === "learning", "SM2: learning after fail");

  // Forgetting probability
  const now = new Date();
  const fp0 = estimateForgettingProbability(null, 1, 2.5);
  assert(fp0 === 0.5, "SM2: forgetting=0.5 when never reviewed");

  const recentReview = new Date(now.getTime() - 1000 * 60 * 60); // 1 hour ago
  const fpRecent = estimateForgettingProbability(recentReview, 7, 2.5);
  assert(fpRecent < 0.1, "SM2: low forgetting right after review");

  console.log("  ✓ SM-2 engine: all invariants hold");
}

// ─── Weak Signals Regression ────────────────────────────────

section("Weak Signals Regression");

{
  // High error rate — trigger via calculateNextState failures
  let highErrState = initializeMastery();
  // 1 correct, 3 incorrect → 75% error rate, total ≥ 3 reviews
  highErrState = calculateNextState(highErrState, 4).nextState; // correct=1
  highErrState = calculateNextState(highErrState, 1).nextState; // incorrect=1
  highErrState = calculateNextState(highErrState, 1).nextState; // incorrect=2
  highErrState = calculateNextState(highErrState, 1).nextState; // incorrect=3
  assert(highErrState.isWeakArea === true, "WS: weak area after high error rate");
  assert(highErrState.weakSignals.includes("high_error_rate"), "WS: high_error_rate signal");

  // Repeated skips — trigger via handleSkip
  let skipState = initializeMastery();
  for (let i = 0; i < 3; i++) {
    skipState = handleSkip(skipState).nextState;
  }
  assert(skipState.isWeakArea === true, "WS: weak area after 3 skips");
  assert(skipState.weakSignals.includes("repeated_skips"), "WS: repeated_skips signal");

  // Repeated resets — 3+ incorrect with low reps
  let resetState = initializeMastery();
  resetState = calculateNextState(resetState, 1).nextState; // incorrect=1, reps=0
  resetState = calculateNextState(resetState, 1).nextState; // incorrect=2, reps=0
  resetState = calculateNextState(resetState, 1).nextState; // incorrect=3, reps=0
  assert(resetState.weakSignals.includes("repeated_resets"), "WS: repeated_resets signal");

  // No signals for healthy learner
  let healthyState = initializeMastery();
  for (let i = 0; i < 5; i++) {
    healthyState = calculateNextState(healthyState, 5).nextState;
  }
  assert(healthyState.isWeakArea === false, "WS: healthy learner not weak");
  assert(healthyState.weakSignals.length === 0, "WS: no signals for healthy learner");

  console.log("  ✓ Weak signal detection: all cases correct");
}

// ─── Normalizer Edge Cases ──────────────────────────────────

section("Normalizer Edge Cases");

{
  // Completely empty eventMetadata
  const empty = makeEvent({
    eventType: "review",
    eventMetadata: {},
  });
  const ne = normalizeEvent(empty);
  assert(ne.questionId === null, "Edge: empty metadata → questionId null");
  assert(ne.selfAssessment === null, "Edge: empty metadata → selfAssessment null");
  assert(ne.previousInterval === null, "Edge: empty metadata → previousInterval null");
  assert(ne.skipCount === null, "Edge: empty metadata → skipCount null");
  assert(ne.rawEventType === "review", "Edge: rawEventType preserved");

  // null eventMetadata
  const nullMeta = makeEvent({
    eventType: "review",
    eventMetadata: null as unknown as Record<string, unknown>,
  });
  const nn = normalizeEvent(nullMeta);
  assert(nn.questionId === null, "Edge: null metadata → questionId null");

  // Invalid selfAssessment value
  const badAssess = makeEvent({
    eventType: "self_assessment",
    eventMetadata: { selfAssessment: "kinda_remembered" },
  });
  const nba = normalizeEvent(badAssess);
  assert(nba.selfAssessment === null, "Edge: invalid selfAssessment → null");

  // Wrong type in metadata (number where string expected)
  const wrongType = makeEvent({
    eventType: "mcq_attempt",
    eventMetadata: { questionId: 12345, confidence: "high" },
  });
  const nwt = normalizeEvent(wrongType);
  assert(nwt.questionId === null, "Edge: number questionId → null");
  assert(nwt.confidence === null, "Edge: string confidence → null");

  console.log("  ✓ Normalizer edge cases: all handled safely");
}

// ─── Duplicate Event Check ──────────────────────────────────

section("No Duplicate Mastery Events");

{
  // Verify that the SM-2 pipeline produces exactly one state transition
  // per quality input — no hidden multiplier
  const state = initializeMastery();
  const r1 = calculateNextState(state, 4);
  assert(r1.nextState.correctCount === 1, "Dup: exactly 1 correct increment");
  assert(r1.nextState.repetitionCount === 1, "Dup: exactly 1 rep increment");

  // Calling again with the SAME state shouldn't double-count
  const r2 = calculateNextState(state, 4);
  assert(r2.nextState.correctCount === 1, "Dup: idempotent on same input");

  // Sequential calls properly chain
  const r3 = calculateNextState(r1.nextState, 4);
  assert(r3.nextState.correctCount === 2, "Dup: sequential chain works");

  console.log("  ✓ No duplicate mastery events: one transition per call");
}

// ─── Summary ────────────────────────────────────────────────

section("RESULTS");

console.log(`\n  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);

if (failures.length > 0) {
  console.log(`\n  Failures:`);
  failures.forEach((f) => console.log(`    - ${f}`));
}

console.log(`\n  ${failed === 0 ? "✅ R1 EVIDENCE FOUNDATION: READY FOR R2" : "❌ R1 EVIDENCE FOUNDATION: NOT READY"}\n`);

process.exit(failed > 0 ? 1 : 0);
