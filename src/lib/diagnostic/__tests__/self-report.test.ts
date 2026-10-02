/**
 * R2 Enhancement — Student Self-Report Validation
 *
 * Tests that self-report integrates correctly into the diagnostic pipeline:
 * 1. Self-report is correctly stored as a feature.
 * 2. Each of the 5 options maps correctly to internal representation.
 * 3. Self-report reaches the diagnostic layer.
 * 4. Self-report can support an existing diagnosis.
 * 5. Self-report does NOT blindly override behavioral evidence.
 * 6. Calibration Gap remains evidence-driven.
 * 7. Existing behavior unchanged when no self-report exists.
 * 8. R2→R3 handoff contract remains valid.
 *
 * Run: npx tsx src/lib/diagnostic/__tests__/self-report.test.ts
 */

import { extractFeatures } from "@/lib/diagnostic/feature.extractor";
import { diagnose, DEFAULT_SCORING_CONFIG } from "@/lib/diagnostic/diagnostic.engine";
import { normalizeEvents } from "@/lib/evidence/evidence.normalizer";
import type { NormalizedEvidence, StudentDifficulty } from "@/lib/evidence/evidence.types";
import type { ConceptFeatures } from "@/lib/diagnostic/feature.types";
import type { DiagnosisType } from "@/lib/diagnostic/diagnostic.types";

// ─── Test Helpers ─────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];
const NOW = new Date("2026-08-19T12:00:00Z");

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

function feat(overrides: Partial<ConceptFeatures> = {}): ConceptFeatures {
  return {
    conceptId: "concept-001",
    totalEvents: 0,
    mcqAttemptCount: 0,
    revisionAttemptCount: 0,
    accuracy: null,
    recentAccuracy: null,
    hasSuccessHistory: false,
    daysSinceLastSuccess: null,
    consecutiveFailures: 0,
    hasRepeatedWrongAnswer: false,
    intervalDecreasing: null,
    confidenceMismatchRate: null,
    eventsWithConfidence: 0,
    recallSuccessRate: null,
    skipCount: 0,
    skipRate: null,
    studentDifficulty: null,
    daysSinceLastEvent: 0,
    lastEventAt: NOW,
    ...overrides,
  };
}

function getDiagnosis(report: ReturnType<typeof diagnose>, type: DiagnosisType) {
  return report.diagnoses.find((d) => d.type === type)!;
}

// ─── Test 1: Self-report correctly stored as feature ────────

section("1. Self-report correctly stored as feature");
{
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: true, timestamp: new Date("2026-07-01") }),
    ev({
      eventType: "self_report",
      studentDifficulty: "concept_understanding",
      timestamp: new Date("2026-08-01"),
    }),
  ];
  const f = extractFeatures(events, NOW);
  assert(f.studentDifficulty === "concept_understanding", "1a: studentDifficulty extracted");
  assert(f.totalEvents === 2, "1b: self_report counted as event");
  console.log(`  ✓ studentDifficulty=${f.studentDifficulty}, totalEvents=${f.totalEvents}`);
}

{
  // Most recent self-report wins
  const events = [
    ev({
      eventType: "self_report",
      studentDifficulty: "concept_understanding",
      timestamp: new Date("2026-07-01"),
    }),
    ev({ eventType: "mcq_attempt", mcqCorrect: true, timestamp: new Date("2026-07-15") }),
    ev({
      eventType: "self_report",
      studentDifficulty: "memory_retrieval",
      timestamp: new Date("2026-08-01"),
    }),
  ];
  const f = extractFeatures(events, NOW);
  assert(f.studentDifficulty === "memory_retrieval", "1c: most recent self-report wins");
  console.log(`  ✓ Most recent self-report: ${f.studentDifficulty}`);
}

// ─── Test 2: Each option maps correctly ─────────────────────

section("2. Each of the 5 options maps correctly");
{
  const options: StudentDifficulty[] = [
    "concept_understanding",
    "memory_retrieval",
    "question_performance",
    "revision_need",
    "uncertain",
  ];
  for (const opt of options) {
    const events = [
      ev({ eventType: "self_report", studentDifficulty: opt, timestamp: new Date("2026-08-01") }),
    ];
    const f = extractFeatures(events, NOW);
    assert(f.studentDifficulty === opt, `2: ${opt} maps correctly`);
  }
  console.log("  ✓ All 5 options map to correct internal representation");
}

// ─── Test 3: Self-report reaches diagnostic layer ───────────

section("3. Self-report reaches diagnostic layer");
{
  // Concept Gap features + matching self-report
  const f = feat({
    totalEvents: 5,
    mcqAttemptCount: 5,
    accuracy: 0.20,
    recentAccuracy: 0.0,
    consecutiveFailures: 4,
    studentDifficulty: "concept_understanding",
  });
  const r = diagnose(f, NOW);
  const cg = getDiagnosis(r, "concept_gap");
  assert(cg.active === true, "3a: Concept Gap active");

  // Check that self-report appears in contributions
  const selfReportContrib = cg.topContributions.find(
    (c) => c.featureName === "studentDifficulty"
  );
  assert(selfReportContrib !== undefined, "3b: self-report in contributions");
  assert(
    selfReportContrib !== undefined && selfReportContrib.contributionWeight > 0,
    "3c: self-report has positive weight"
  );
  console.log(`  ✓ Self-report contribution: weight=${selfReportContrib?.contributionWeight}`);
}

// ─── Test 4: Self-report supports existing diagnosis ────────

section("4. Self-report supports an existing diagnosis");
{
  // Borderline Concept Gap WITHOUT self-report
  const fWithout = feat({
    totalEvents: 4,
    mcqAttemptCount: 4,
    accuracy: 0.25,
    recentAccuracy: 0.25,
    consecutiveFailures: 2,
    studentDifficulty: null,
  });
  const rWithout = diagnose(fWithout, NOW);
  const cgWithout = getDiagnosis(rWithout, "concept_gap");

  // Same features WITH matching self-report
  const fWith = feat({
    totalEvents: 4,
    mcqAttemptCount: 4,
    accuracy: 0.25,
    recentAccuracy: 0.25,
    consecutiveFailures: 2,
    studentDifficulty: "concept_understanding",
  });
  const rWith = diagnose(fWith, NOW);
  const cgWith = getDiagnosis(rWith, "concept_gap");

  assert(cgWith.score > cgWithout.score, "4a: self-report increases score");

  // The increase should be modest (≤ 0.10)
  const delta = cgWith.score - cgWithout.score;
  assert(delta <= 0.11, "4b: increase is modest (≤0.10)");
  console.log(`  ✓ Without: ${cgWithout.score}, With: ${cgWith.score}, Delta: ${delta.toFixed(2)}`);
}

{
  // Memory Gap with matching self-report
  const fWith = feat({
    totalEvents: 6,
    mcqAttemptCount: 4,
    revisionAttemptCount: 2,
    accuracy: 0.50,
    recentAccuracy: 0.25,
    hasSuccessHistory: true,
    daysSinceLastSuccess: 15,
    intervalDecreasing: true,
    recallSuccessRate: 0.40,
    studentDifficulty: "memory_retrieval",
  });
  const fWithout = { ...fWith, studentDifficulty: null as ConceptFeatures["studentDifficulty"] };

  const mgWith = getDiagnosis(diagnose(fWith, NOW), "memory_gap");
  const mgWithout = getDiagnosis(diagnose(fWithout, NOW), "memory_gap");

  assert(mgWith.score > mgWithout.score, "4c: memory self-report supports Memory Gap");
  console.log(`  ✓ Memory Gap: without=${mgWithout.score}, with=${mgWith.score}`);
}

// ─── Test 5: Self-report does NOT override behavioral evidence ─

section("5. Self-report does NOT override behavioral evidence");
{
  // Student says "I don't understand" but evidence shows mastery
  const f = feat({
    totalEvents: 8,
    mcqAttemptCount: 6,
    revisionAttemptCount: 2,
    accuracy: 0.83,       // 5/6 correct — strong understanding
    recentAccuracy: 0.80,
    hasSuccessHistory: true,
    daysSinceLastSuccess: 1,
    consecutiveFailures: 0,
    studentDifficulty: "concept_understanding", // says "I don't understand"
  });
  const r = diagnose(f, NOW);
  const cg = getDiagnosis(r, "concept_gap");

  // Counter-evidence from good accuracy should dominate
  assert(cg.active === false, "5a: Concept Gap inactive despite self-report");
  assert(cg.score < 0.40, "5b: score well below threshold");
  console.log(`  ✓ Good accuracy overrides self-report: CG score=${cg.score}, active=${cg.active}`);
}

{
  // Student says "I understand but forget" but evidence shows never learned
  const f = feat({
    totalEvents: 5,
    mcqAttemptCount: 5,
    accuracy: 0.0,
    recentAccuracy: 0.0,
    consecutiveFailures: 5,
    hasSuccessHistory: false, // never demonstrated understanding
    studentDifficulty: "memory_retrieval",
  });
  const r = diagnose(f, NOW);
  const mg = getDiagnosis(r, "memory_gap");
  const cg = getDiagnosis(r, "concept_gap");

  // Memory Gap requires hasSuccessHistory = true (eligibility gate)
  assert(mg.active === false, "5c: Memory Gap inactive (no success history)");
  assert(mg.score === 0, "5d: Memory Gap score=0 (eligibility gate)");
  // Concept Gap should be active instead
  assert(cg.active === true, "5e: Concept Gap active (actual problem)");
  console.log(`  ✓ Self-report "forget" overridden by evidence: MG=${mg.score}, CG=${cg.score}`);
}

{
  // Student says "concept_understanding" but evidence shows strong performance
  // recently with just one old failure
  const f = feat({
    totalEvents: 6,
    mcqAttemptCount: 6,
    accuracy: 0.67,       // above threshold
    recentAccuracy: 0.80, // strong recent
    hasSuccessHistory: true,
    daysSinceLastSuccess: 1,
    consecutiveFailures: 0,
    studentDifficulty: "concept_understanding",
  });
  const r = diagnose(f, NOW);
  const cg = getDiagnosis(r, "concept_gap");
  // Self-report adds 0.10 but counter-evidence (-0.15) dominates
  assert(cg.active === false, "5f: self-report alone cannot activate diagnosis");
  console.log(`  ✓ Self-report alone cannot activate: CG=${cg.score}`);
}

// ─── Test 6: Calibration Gap remains evidence-driven ────────

section("6. Calibration Gap remains evidence-driven");
{
  // Student says "I make mistakes in questions" but calibration evidence is clean
  const f = feat({
    totalEvents: 5,
    mcqAttemptCount: 5,
    accuracy: 0.40,
    confidenceMismatchRate: 0.10, // well calibrated
    eventsWithConfidence: 5,
    studentDifficulty: "question_performance",
  });
  const r = diagnose(f, NOW);
  const cal = getDiagnosis(r, "calibration_gap");

  // Self-report adds 0.10 but counter-evidence from aligned confidence
  // should keep it inactive
  assert(cal.active === false, "6a: Calibration Gap inactive despite self-report");
  console.log(`  ✓ Well-calibrated + self-report: Cal=${cal.score}, active=${cal.active}`);
}

{
  // Real calibration problem + matching self-report
  const f = feat({
    totalEvents: 5,
    mcqAttemptCount: 5,
    accuracy: 0.40,
    confidenceMismatchRate: 0.60,
    eventsWithConfidence: 5,
    studentDifficulty: "question_performance",
  });
  const fWithout = { ...f, studentDifficulty: null as ConceptFeatures["studentDifficulty"] };

  const calWith = getDiagnosis(diagnose(f, NOW), "calibration_gap");
  const calWithout = getDiagnosis(diagnose(fWithout, NOW), "calibration_gap");

  // Both should be active, but self-report modestly increases score
  assert(calWith.active === true, "6b: Calibration active with matching self-report");
  assert(calWithout.active === true, "6c: Calibration active without self-report too");
  assert(calWith.score > calWithout.score, "6d: self-report modestly increases");
  assert(calWith.score - calWithout.score <= 0.11, "6e: increase is modest");
  console.log(`  ✓ Cal without=${calWithout.score}, with=${calWith.score}`);
}

// ─── Test 7: Existing behavior unchanged when no self-report ─

section("7. Existing behavior unchanged with no self-report");
{
  // Exact same scenario from R2.3 tests — should produce identical results
  const f = feat({
    totalEvents: 6,
    mcqAttemptCount: 6,
    accuracy: 0.17,
    recentAccuracy: 0.0,
    consecutiveFailures: 4,
    hasRepeatedWrongAnswer: true,
    studentDifficulty: null,
  });
  const r = diagnose(f, NOW);
  const cg = getDiagnosis(r, "concept_gap");

  assert(cg.active === true, "7a: Concept Gap active (same as before)");
  assert(cg.score > 0.5, "7b: high score (same as before)");

  // Self-report contribution should NOT appear
  const selfContrib = cg.topContributions.find((c) => c.featureName === "studentDifficulty");
  assert(selfContrib === undefined, "7c: no self-report contribution when null");
  console.log(`  ✓ No self-report → identical behavior: CG=${cg.score}`);
}

{
  // "uncertain" should not contribute to any diagnosis
  const f = feat({
    totalEvents: 5,
    mcqAttemptCount: 5,
    accuracy: 0.20,
    recentAccuracy: 0.0,
    consecutiveFailures: 4,
    studentDifficulty: "uncertain",
  });
  const fNull = { ...f, studentDifficulty: null as ConceptFeatures["studentDifficulty"] };

  const rUncertain = diagnose(f, NOW);
  const rNull = diagnose(fNull, NOW);

  // Scores should be identical — "uncertain" contributes nothing
  for (const type of ["concept_gap", "memory_gap", "calibration_gap", "revision_gap"] as DiagnosisType[]) {
    const dU = getDiagnosis(rUncertain, type);
    const dN = getDiagnosis(rNull, type);
    assert(dU.score === dN.score, `7d: ${type} same score with uncertain`);
  }
  console.log("  ✓ 'uncertain' produces identical scores to null");
}

// ─── Test 8: Normalizer handles studentDifficulty ───────────

section("8. Normalizer extracts studentDifficulty from JSONB");
{
  // Simulate a raw DB record with studentDifficulty in eventMetadata
  const rawRecords = [{
    id: crypto.randomUUID(),
    userId: "user-001",
    conceptId: "concept-001",
    eventType: "self_report",
    qualityRating: null,
    mcqCorrect: null,
    mcqQuestionIndex: null,
    eventMetadata: { studentDifficulty: "memory_retrieval" },
    createdAt: new Date("2026-08-01"),
  }];

  const normalized = normalizeEvents(rawRecords);
  assert(normalized.length === 1, "8a: one event normalized");
  assert(normalized[0].eventType === "self_report", "8b: event type = self_report");
  assert(normalized[0].studentDifficulty === "memory_retrieval", "8c: studentDifficulty extracted");
  console.log(`  ✓ Normalized: type=${normalized[0].eventType}, difficulty=${normalized[0].studentDifficulty}`);
}

{
  // Invalid/unknown difficulty should normalize to null
  const rawRecords = [{
    id: crypto.randomUUID(),
    userId: "user-001",
    conceptId: "concept-001",
    eventType: "self_report",
    qualityRating: null,
    mcqCorrect: null,
    mcqQuestionIndex: null,
    eventMetadata: { studentDifficulty: "invalid_value" },
    createdAt: new Date("2026-08-01"),
  }];

  const normalized = normalizeEvents(rawRecords);
  assert(normalized[0].studentDifficulty === null, "8d: invalid difficulty → null");
  console.log("  ✓ Invalid difficulty value → null (safe)");
}

{
  // Legacy event without studentDifficulty → null
  const rawRecords = [{
    id: crypto.randomUUID(),
    userId: "user-001",
    conceptId: "concept-001",
    eventType: "mcq_attempt",
    qualityRating: 4,
    mcqCorrect: true,
    mcqQuestionIndex: 0,
    eventMetadata: {},
    createdAt: new Date("2026-08-01"),
  }];

  const normalized = normalizeEvents(rawRecords);
  assert(normalized[0].studentDifficulty === null, "8e: legacy event → null studentDifficulty");
  console.log("  ✓ Legacy event without field → studentDifficulty=null");
}

// ─── Test 9: Cross-diagnosis self-report ────────────────────

section("9. Self-report only affects matching diagnosis");
{
  // Self-report "concept_understanding" should NOT increase Memory/Cal/Revision scores
  const fWith = feat({
    totalEvents: 8,
    mcqAttemptCount: 5,
    revisionAttemptCount: 3,
    accuracy: 0.40,
    recentAccuracy: 0.20,
    hasSuccessHistory: true,
    daysSinceLastSuccess: 15,
    intervalDecreasing: true,
    recallSuccessRate: 0.33,
    confidenceMismatchRate: 0.50,
    eventsWithConfidence: 4,
    skipCount: 2,
    skipRate: 0.40,
    daysSinceLastEvent: 5,
    studentDifficulty: "concept_understanding",
  });
  const fWithout = { ...fWith, studentDifficulty: null as ConceptFeatures["studentDifficulty"] };

  const rWith = diagnose(fWith, NOW);
  const rWithout = diagnose(fWithout, NOW);

  // Concept Gap should increase
  assert(
    getDiagnosis(rWith, "concept_gap").score > getDiagnosis(rWithout, "concept_gap").score,
    "9a: concept_understanding increases Concept Gap"
  );

  // Memory, Calibration, Revision should be unchanged
  assert(
    getDiagnosis(rWith, "memory_gap").score === getDiagnosis(rWithout, "memory_gap").score,
    "9b: Memory Gap unchanged"
  );
  assert(
    getDiagnosis(rWith, "calibration_gap").score === getDiagnosis(rWithout, "calibration_gap").score,
    "9c: Calibration Gap unchanged"
  );
  assert(
    getDiagnosis(rWith, "revision_gap").score === getDiagnosis(rWithout, "revision_gap").score,
    "9d: Revision Gap unchanged"
  );
  console.log("  ✓ Self-report only affects the matching diagnosis");
}

// ─── Test 10: Full pipeline with self-report ────────────────

section("10. E2E pipeline: evidence + self-report → diagnosis");
{
  // Student mastered concept, then forgot, and reports "I understand but forget it"
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: true, confidence: 3, timestamp: new Date("2026-06-01") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: true, confidence: 3, timestamp: new Date("2026-06-10") }),
    ev({ eventType: "self_assessment", selfAssessment: "remembered", timestamp: new Date("2026-06-15") }),
    // decay
    ev({ eventType: "mcq_attempt", mcqCorrect: false, confidence: 2, previousInterval: 10, newInterval: 1, timestamp: new Date("2026-07-20") }),
    ev({ eventType: "self_assessment", selfAssessment: "forgot", timestamp: new Date("2026-07-25") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, confidence: 1, timestamp: new Date("2026-07-28") }),
    // self-report
    ev({ eventType: "self_report", studentDifficulty: "memory_retrieval", timestamp: new Date("2026-08-01") }),
  ];

  const features = extractFeatures(events, NOW);
  assert(features.studentDifficulty === "memory_retrieval", "10a: feature extracted");
  assert(features.hasSuccessHistory === true, "10b: success history present");
  assert(features.totalEvents === 7, "10c: all 7 events counted");

  const report = diagnose(features, NOW);
  const mg = getDiagnosis(report, "memory_gap");
  const cg = getDiagnosis(report, "concept_gap");

  assert(mg.active === true, "10d: Memory Gap active (evidence + self-report agree)");
  assert(mg.score > cg.score, "10e: Memory Gap > Concept Gap (correct diagnosis)");
  assert(report.primaryDiagnosis?.type === "memory_gap", "10f: primary = memory_gap");

  // Self-report should appear in Memory Gap contributions
  const selfContrib = mg.topContributions.find((c) => c.featureName === "studentDifficulty");
  assert(selfContrib !== undefined, "10g: self-report in MG contributions");

  console.log(`  ✓ E2E: MG=${mg.score}, CG=${cg.score}, primary=${report.primaryDiagnosis?.type}`);
}

{
  // Student says "I understand but forget" but evidence shows concept gap
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: false, selectedAnswer: "a", correctAnswer: "c", timestamp: new Date("2026-07-01") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, selectedAnswer: "a", correctAnswer: "c", timestamp: new Date("2026-07-05") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, selectedAnswer: "a", correctAnswer: "c", timestamp: new Date("2026-07-10") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, selectedAnswer: "a", correctAnswer: "c", timestamp: new Date("2026-07-15") }),
    // self-report says memory but evidence says concept
    ev({ eventType: "self_report", studentDifficulty: "memory_retrieval", timestamp: new Date("2026-08-01") }),
  ];

  const features = extractFeatures(events, NOW);
  const report = diagnose(features, NOW);
  const cg = getDiagnosis(report, "concept_gap");
  const mg = getDiagnosis(report, "memory_gap");

  assert(cg.active === true, "10h: Concept Gap active (evidence-driven)");
  assert(mg.active === false, "10i: Memory Gap inactive (no success history)");
  assert(report.primaryDiagnosis?.type === "concept_gap", "10j: primary = concept_gap (evidence wins)");

  console.log(`  ✓ Mismatched self-report: CG=${cg.score}, MG=${mg.score}, primary=${report.primaryDiagnosis?.type}`);
  console.log("    Evidence correctly overrides self-report");
}

// ─── Summary ────────────────────────────────────────────────

section("RESULTS");

console.log(`\n  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);

if (failures.length > 0) {
  console.log(`\n  Failures:`);
  failures.forEach((f) => console.log(`    - ${f}`));
}

console.log(`\n  ${failed === 0 ? "✅ SELF-REPORT ENHANCEMENT: VALIDATED" : "❌ SELF-REPORT ENHANCEMENT: ISSUES FOUND"}\n`);

process.exit(failed > 0 ? 1 : 0);
