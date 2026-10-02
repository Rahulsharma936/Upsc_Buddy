/**
 * R2.2 Feature Extraction Validation
 *
 * Tests all feature computations against synthetic evidence.
 *
 * Run: npx tsx src/lib/diagnostic/__tests__/feature-extraction.test.ts
 */

import { extractFeatures } from "@/lib/diagnostic/feature.extractor";
import type { NormalizedEvidence } from "@/lib/evidence/evidence.types";

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

function approxEq(a: number, b: number, tolerance = 0.01): boolean {
  return Math.abs(a - b) <= tolerance;
}

/** Create a synthetic NormalizedEvidence record. */
function ev(overrides: Partial<NormalizedEvidence> & {
  eventType: NormalizedEvidence["eventType"];
  timestamp: Date;
}): NormalizedEvidence {
  return {
    eventId: crypto.randomUUID(),
    userId: "user-001",
    conceptId: "concept-001",
    rawEventType: overrides.eventType,
    qualityRating: null,
    mcqCorrect: null,
    mcqQuestionIndex: null,
    questionId: null,
    selectedAnswer: null,
    correctAnswer: null,
    confidence: null,
    selfAssessment: null,
    studentDifficulty: null,
    failureReason: null,
    previousInterval: null,
    newInterval: null,
    previousEase: null,
    newEase: null,
    skipCount: null,
    ...overrides,
  };
}

const NOW = new Date("2026-08-03T12:00:00Z");

// ─── Empty Evidence ─────────────────────────────────────────

section("Empty evidence");

{
  const f = extractFeatures([], NOW);
  assert(f.totalEvents === 0, "Empty: totalEvents=0");
  assert(f.accuracy === null, "Empty: accuracy=null");
  assert(f.hasSuccessHistory === false, "Empty: no success history");
  assert(f.consecutiveFailures === 0, "Empty: no failures");
  assert(f.skipCount === 0, "Empty: no skips");
  console.log("  ✓ Empty evidence → all-null/zero features");
}

// ─── Accuracy Features ─────────────────────────────────────

section("Accuracy features");

{
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: true, timestamp: new Date("2026-07-01") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: true, timestamp: new Date("2026-07-02") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, timestamp: new Date("2026-07-03") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: true, timestamp: new Date("2026-07-04") }),
  ];
  const f = extractFeatures(events, NOW);

  assert(f.mcqAttemptCount === 4, "Acc: 4 MCQ attempts");
  assert(f.accuracy !== null && approxEq(f.accuracy, 0.75), "Acc: accuracy=0.75");

  // Recent accuracy (default window=5, so all 4 count)
  assert(f.recentAccuracy !== null && approxEq(f.recentAccuracy, 0.75), "Acc: recentAccuracy=0.75");
  console.log("  ✓ Accuracy: 3/4 = 0.75");
}

{
  // Only 1 MCQ → recentAccuracy should be null (< 2)
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: true, timestamp: new Date("2026-07-01") }),
  ];
  const f = extractFeatures(events, NOW);
  assert(f.recentAccuracy === null, "Acc: recentAccuracy=null with 1 event");
  console.log("  ✓ Sparse MCQ → recentAccuracy=null");
}

// ─── Prior Learning Evidence ────────────────────────────────

section("Prior learning evidence");

{
  // Has correct MCQ → hasSuccessHistory = true
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: false, timestamp: new Date("2026-07-01") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: true, timestamp: new Date("2026-07-05") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, timestamp: new Date("2026-07-10") }),
  ];
  const f = extractFeatures(events, NOW);
  assert(f.hasSuccessHistory === true, "Prior: has success");
  assert(f.daysSinceLastSuccess !== null, "Prior: daysSinceLastSuccess not null");
  // Last success was July 5, now is Aug 3 = 29 days
  assert(f.daysSinceLastSuccess !== null && approxEq(f.daysSinceLastSuccess, 29, 0.5), "Prior: ~29 days since success");
  console.log("  ✓ Has MCQ correct → hasSuccessHistory=true");
}

{
  // Only "remembered" revision → also counts as success
  const events = [
    ev({
      eventType: "self_assessment", selfAssessment: "remembered",
      timestamp: new Date("2026-08-01"),
    }),
  ];
  const f = extractFeatures(events, NOW);
  assert(f.hasSuccessHistory === true, "Prior: remembered = success");
  assert(f.daysSinceLastSuccess !== null && approxEq(f.daysSinceLastSuccess, 2, 0.5), "Prior: ~2 days since remembered");
  console.log("  ✓ Revision 'remembered' → hasSuccessHistory=true");
}

{
  // All incorrect, no "remembered" → no success history
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: false, timestamp: new Date("2026-07-01") }),
    ev({
      eventType: "self_assessment", selfAssessment: "forgot",
      timestamp: new Date("2026-07-02"),
    }),
  ];
  const f = extractFeatures(events, NOW);
  assert(f.hasSuccessHistory === false, "Prior: no success history");
  assert(f.daysSinceLastSuccess === null, "Prior: daysSinceLastSuccess=null");
  console.log("  ✓ No correct + no remembered → no success history");
}

// ─── Consecutive Failures ───────────────────────────────────

section("Consecutive failures");

{
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: true, timestamp: new Date("2026-07-01") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, timestamp: new Date("2026-07-02") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, timestamp: new Date("2026-07-03") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, timestamp: new Date("2026-07-04") }),
  ];
  const f = extractFeatures(events, NOW);
  assert(f.consecutiveFailures === 3, "CF: 3 consecutive failures");
  console.log("  ✓ Correct → 3 wrong = consecutiveFailures=3");
}

{
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: false, timestamp: new Date("2026-07-01") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, timestamp: new Date("2026-07-02") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: true, timestamp: new Date("2026-07-03") }),
  ];
  const f = extractFeatures(events, NOW);
  assert(f.consecutiveFailures === 0, "CF: streak broken by correct");
  console.log("  ✓ Failures then correct → consecutiveFailures=0");
}

// ─── Repeated Wrong Answer ──────────────────────────────────

section("Repeated wrong answer pattern");

{
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: false, selectedAnswer: "a", timestamp: new Date("2026-07-01") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, selectedAnswer: "a", timestamp: new Date("2026-07-02") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, selectedAnswer: "b", timestamp: new Date("2026-07-03") }),
  ];
  const f = extractFeatures(events, NOW);
  // "a" appears 2/3 = 67% ≥ 50%
  assert(f.hasRepeatedWrongAnswer === true, "RWA: same wrong answer ≥50%");
  console.log("  ✓ Same wrong answer 67% → hasRepeatedWrongAnswer=true");
}

{
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: false, selectedAnswer: "a", timestamp: new Date("2026-07-01") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, selectedAnswer: "b", timestamp: new Date("2026-07-02") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, selectedAnswer: "c", timestamp: new Date("2026-07-03") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, selectedAnswer: "d", timestamp: new Date("2026-07-04") }),
  ];
  const f = extractFeatures(events, NOW);
  // All different → max 25% < 50%
  assert(f.hasRepeatedWrongAnswer === false, "RWA: all different answers → false");
  console.log("  ✓ All different wrong answers → hasRepeatedWrongAnswer=false");
}

{
  // Legacy events without selectedAnswer
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: false, timestamp: new Date("2026-07-01") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, timestamp: new Date("2026-07-02") }),
  ];
  const f = extractFeatures(events, NOW);
  assert(f.hasRepeatedWrongAnswer === false, "RWA: no selectedAnswer → false");
  console.log("  ✓ Legacy events (no selectedAnswer) → hasRepeatedWrongAnswer=false");
}

// ─── Interval Trajectory ────────────────────────────────────

section("Interval trajectory");

{
  const events = [
    ev({
      eventType: "mcq_attempt", mcqCorrect: true,
      previousInterval: 3, newInterval: 8,
      timestamp: new Date("2026-07-01"),
    }),
    ev({
      eventType: "mcq_attempt", mcqCorrect: false,
      previousInterval: 8, newInterval: 1,
      timestamp: new Date("2026-07-05"),
    }),
  ];
  const f = extractFeatures(events, NOW);
  // Most recent: 8 → 1 = decreasing
  assert(f.intervalDecreasing === true, "Int: interval decreased");
  console.log("  ✓ Most recent interval shrunk → intervalDecreasing=true");
}

{
  const events = [
    ev({
      eventType: "mcq_attempt", mcqCorrect: true,
      previousInterval: 1, newInterval: 3,
      timestamp: new Date("2026-07-01"),
    }),
  ];
  const f = extractFeatures(events, NOW);
  assert(f.intervalDecreasing === false, "Int: interval grew");
  console.log("  ✓ Interval grew → intervalDecreasing=false");
}

// ─── Confidence Mismatch ────────────────────────────────────

section("Confidence mismatch rate");

{
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: false, confidence: 3, timestamp: new Date("2026-07-01") }), // overconfident
    ev({ eventType: "mcq_attempt", mcqCorrect: true, confidence: 3, timestamp: new Date("2026-07-02") }),  // calibrated
    ev({ eventType: "mcq_attempt", mcqCorrect: true, confidence: 1, timestamp: new Date("2026-07-03") }),  // underconfident
    ev({ eventType: "mcq_attempt", mcqCorrect: false, confidence: 1, timestamp: new Date("2026-07-04") }), // calibrated (low & wrong)
  ];
  const f = extractFeatures(events, NOW);
  // 2 mismatches (overconfident + underconfident) / 4 total = 0.5
  assert(f.confidenceMismatchRate !== null && approxEq(f.confidenceMismatchRate, 0.5), "CM: mismatch=0.5");
  assert(f.eventsWithConfidence === 4, "CM: 4 events with confidence");
  console.log("  ✓ 2/4 miscalibrated → confidenceMismatchRate=0.5");
}

{
  // No confidence data → null
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: true, timestamp: new Date("2026-07-01") }),
  ];
  const f = extractFeatures(events, NOW);
  assert(f.confidenceMismatchRate === null, "CM: no confidence → null");
  assert(f.eventsWithConfidence === 0, "CM: 0 events with confidence");
  console.log("  ✓ Legacy events (no confidence) → null");
}

// ─── Recall Success Rate ────────────────────────────────────

section("Recall success rate");

{
  const events = [
    ev({ eventType: "self_assessment", selfAssessment: "remembered", timestamp: new Date("2026-07-01") }),
    ev({ eventType: "self_assessment", selfAssessment: "partially", timestamp: new Date("2026-07-03") }),
    ev({ eventType: "self_assessment", selfAssessment: "forgot", timestamp: new Date("2026-07-05") }),
  ];
  const f = extractFeatures(events, NOW);
  // 1 remembered / 3 total = 0.333
  assert(f.recallSuccessRate !== null && approxEq(f.recallSuccessRate, 0.333), "RSR: 1/3=0.333");
  assert(f.revisionAttemptCount === 3, "RSR: 3 revision attempts");
  console.log("  ✓ 1/3 remembered → recallSuccessRate=0.333");
}

// ─── Skip Rate ──────────────────────────────────────────────

section("Skip rate");

{
  const events = [
    ev({ eventType: "self_assessment", selfAssessment: "remembered", timestamp: new Date("2026-07-01") }),
    ev({ eventType: "skip", skipCount: 1, timestamp: new Date("2026-07-02") }),
    ev({ eventType: "skip", skipCount: 2, timestamp: new Date("2026-07-03") }),
    ev({ eventType: "self_assessment", selfAssessment: "forgot", timestamp: new Date("2026-07-04") }),
  ];
  const f = extractFeatures(events, NOW);
  // 2 skips / (2 skips + 2 revisions) = 0.5
  assert(f.skipCount === 2, "SR: 2 skips");
  assert(f.skipRate !== null && approxEq(f.skipRate, 0.5), "SR: skipRate=0.5");
  console.log("  ✓ 2 skips + 2 revisions → skipRate=0.5");
}

{
  // Only MCQ events, no revision engagement → skipRate=null
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: true, timestamp: new Date("2026-07-01") }),
  ];
  const f = extractFeatures(events, NOW);
  assert(f.skipRate === null, "SR: no revision → skipRate=null");
  console.log("  ✓ No revision engagement → skipRate=null");
}

// ─── Temporal Features ──────────────────────────────────────

section("Temporal features");

{
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: true, timestamp: new Date("2026-07-20T12:00:00Z") }),
  ];
  const f = extractFeatures(events, NOW);
  // July 20 → Aug 3 = 14 days
  assert(approxEq(f.daysSinceLastEvent, 14, 0.5), "Temporal: ~14 days");
  assert(f.lastEventAt.getTime() === new Date("2026-07-20T12:00:00Z").getTime(), "Temporal: lastEventAt");
  console.log("  ✓ 14 days since last event");
}

// ─── Mixed Event Sequence ───────────────────────────────────

section("Realistic mixed sequence");

{
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: true, confidence: 2, timestamp: new Date("2026-07-01") }),
    ev({ eventType: "self_assessment", selfAssessment: "remembered", timestamp: new Date("2026-07-03") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: true, confidence: 3, timestamp: new Date("2026-07-05") }),
    ev({ eventType: "skip", skipCount: 1, timestamp: new Date("2026-07-08") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, confidence: 3, selectedAnswer: "a",
         previousInterval: 8, newInterval: 1, timestamp: new Date("2026-07-15") }),
    ev({ eventType: "self_assessment", selfAssessment: "forgot", timestamp: new Date("2026-07-20") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, confidence: 2, selectedAnswer: "a",
         previousInterval: 1, newInterval: 1, timestamp: new Date("2026-07-25") }),
  ];

  const f = extractFeatures(events, NOW);

  assert(f.totalEvents === 7, "Mix: 7 total events");
  assert(f.mcqAttemptCount === 4, "Mix: 4 MCQ attempts");
  assert(f.revisionAttemptCount === 2, "Mix: 2 revision attempts");
  assert(f.accuracy !== null && approxEq(f.accuracy, 0.5), "Mix: accuracy=0.5 (2/4)");
  assert(f.hasSuccessHistory === true, "Mix: has success history");
  assert(f.consecutiveFailures === 2, "Mix: 2 consecutive failures");
  assert(f.hasRepeatedWrongAnswer === true, "Mix: 'a' repeated ≥50%");
  assert(f.intervalDecreasing === false, "Mix: last interval 1→1 (not decreasing)");
  assert(f.confidenceMismatchRate !== null && approxEq(f.confidenceMismatchRate, 0.5), "Mix: 2/4 mismatch");
  assert(f.recallSuccessRate !== null && approxEq(f.recallSuccessRate, 0.5), "Mix: 1/2 remembered");
  assert(f.skipCount === 1, "Mix: 1 skip");
  assert(f.skipRate !== null && approxEq(f.skipRate, 0.333), "Mix: 1/(1+2)=0.333");

  console.log("  ✓ Realistic 7-event sequence: all features correct");
}

// ─── Config Override ────────────────────────────────────────

section("Config override (recentWindowSize)");

{
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: true, timestamp: new Date("2026-07-01") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: true, timestamp: new Date("2026-07-02") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: true, timestamp: new Date("2026-07-03") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, timestamp: new Date("2026-07-04") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, timestamp: new Date("2026-07-05") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, timestamp: new Date("2026-07-06") }),
  ];

  // Default window=5: last 5 = [T, T, T, F, F] = 3/5 = 0.6
  const f5 = extractFeatures(events, NOW);
  assert(f5.recentAccuracy !== null && approxEq(f5.recentAccuracy, 0.4), "Config: default window=5 → last5=2/5=0.4");

  // Override window=3: last 3 = [F, F, F] = 0/3 = 0.0
  const f3 = extractFeatures(events, NOW, { recentWindowSize: 3 });
  assert(f3.recentAccuracy !== null && approxEq(f3.recentAccuracy, 0.0), "Config: window=3 → last3=0/3=0.0");

  console.log("  ✓ recentWindowSize override changes recentAccuracy");
}

// ─── Summary ────────────────────────────────────────────────

section("RESULTS");

console.log(`\n  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);

if (failures.length > 0) {
  console.log(`\n  Failures:`);
  failures.forEach((f) => console.log(`    - ${f}`));
}

console.log(`\n  ${failed === 0 ? "✅ R2.2 FEATURE EXTRACTION: VALIDATED" : "❌ R2.2 FEATURE EXTRACTION: ISSUES FOUND"}\n`);

process.exit(failed > 0 ? 1 : 0);
