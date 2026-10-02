/**
 * R2.4 — End-to-End Pipeline Validation & Threshold Tuning
 *
 * Tests the complete pipeline: NormalizedEvidence[] → extractFeatures() → diagnose()
 * with realistic UPSC learning histories.
 *
 * Run: npx tsx src/lib/diagnostic/__tests__/e2e-validation.test.ts
 */

import { extractFeatures } from "@/lib/diagnostic/feature.extractor";
import { diagnose, DEFAULT_SCORING_CONFIG } from "@/lib/diagnostic/diagnostic.engine";
import type { NormalizedEvidence } from "@/lib/evidence/evidence.types";
import type { DiagnosisType } from "@/lib/diagnostic/diagnostic.types";

// ─── Helpers ────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];
const NOW = new Date("2026-08-05T12:00:00Z");

function assert(cond: boolean, label: string): void {
  if (cond) { passed++; } else { failed++; failures.push(label); console.error(`  ✗ FAIL: ${label}`); }
}
function section(t: string): void { console.log(`\n── ${t} ${"─".repeat(Math.max(0, 55 - t.length))}`); }

function ev(o: Partial<NormalizedEvidence> & { eventType: NormalizedEvidence["eventType"]; timestamp: Date }): NormalizedEvidence {
  return {
    eventId: crypto.randomUUID(), userId: "u1", conceptId: "c1", rawEventType: o.eventType,
    qualityRating: null, mcqCorrect: null, mcqQuestionIndex: null, questionId: null,
    selectedAnswer: null, correctAnswer: null, confidence: null, selfAssessment: null,
    studentDifficulty: null, failureReason: null,
    previousInterval: null, newInterval: null, previousEase: null, newEase: null, skipCount: null,
    ...o,
  };
}

/** Run full pipeline */
function pipeline(events: NormalizedEvidence[]) {
  const features = extractFeatures(events, NOW);
  return diagnose(features, NOW);
}

function get(report: ReturnType<typeof pipeline>, type: DiagnosisType) {
  return report.diagnoses.find((d) => d.type === type)!;
}

// ─── Scenario 1: Never understood ───────────────────────────

section("S1: Never understood concept");
{
  const events = Array.from({ length: 6 }, (_, i) =>
    ev({ eventType: "mcq_attempt", mcqCorrect: false, confidence: 2,
         selectedAnswer: "a", correctAnswer: "c",
         timestamp: new Date(`2026-07-${(i + 1).toString().padStart(2, "0")}`) })
  );
  const r = pipeline(events);
  const cg = get(r, "concept_gap"), mg = get(r, "memory_gap");
  assert(cg.active === true, "S1: Concept Gap active");
  assert(cg.score >= 0.5, "S1: Concept Gap strong");
  assert(mg.active === false, "S1: Memory Gap inactive (no success history)");
  assert(r.primaryDiagnosis?.type === "concept_gap", "S1: primary = concept_gap");
  assert(cg.explanation.includes("MCQ") || cg.explanation.includes("accuracy"), "S1: explanation references performance");
  console.log(`  ✓ CG=${cg.score} MG=${mg.score} primary=${r.primaryDiagnosis?.type}`);
}

// ─── Scenario 2: Mastered then forgot ───────────────────────

section("S2: Mastered then forgot");
{
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: true, confidence: 3, timestamp: new Date("2026-06-01") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: true, confidence: 3, timestamp: new Date("2026-06-05") }),
    ev({ eventType: "self_assessment", selfAssessment: "remembered", timestamp: new Date("2026-06-10") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: true, confidence: 3, timestamp: new Date("2026-06-15") }),
    // Gap — then failure
    ev({ eventType: "mcq_attempt", mcqCorrect: false, confidence: 2, previousInterval: 10, newInterval: 1, timestamp: new Date("2026-07-20") }),
    ev({ eventType: "self_assessment", selfAssessment: "forgot", timestamp: new Date("2026-07-25") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, confidence: 1, previousInterval: 1, newInterval: 1, timestamp: new Date("2026-07-28") }),
  ];
  const r = pipeline(events);
  const mg = get(r, "memory_gap"), cg = get(r, "concept_gap");
  assert(mg.active === true, "S2: Memory Gap active");
  assert(mg.score > cg.score, "S2: Memory Gap > Concept Gap");
  assert(mg.explanation.length > 0, "S2: Memory Gap has explanation");
  console.log(`  ✓ MG=${mg.score} CG=${cg.score} primary=${r.primaryDiagnosis?.type}`);
}

// ─── Scenario 3: Gradual recovery ───────────────────────────

section("S3: Gradual recovery after revision");
{
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: true, timestamp: new Date("2026-06-01") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, timestamp: new Date("2026-07-01") }),
    ev({ eventType: "self_assessment", selfAssessment: "forgot", timestamp: new Date("2026-07-05") }),
    // Recovery
    ev({ eventType: "self_assessment", selfAssessment: "partially", timestamp: new Date("2026-07-10") }),
    ev({ eventType: "self_assessment", selfAssessment: "remembered", timestamp: new Date("2026-07-15") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: true, confidence: 2, timestamp: new Date("2026-07-20") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: true, confidence: 3, timestamp: new Date("2026-07-25") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: true, confidence: 3, timestamp: new Date("2026-08-01") }),
  ];
  const r = pipeline(events);
  const mg = get(r, "memory_gap"), cg = get(r, "concept_gap");
  // Recent accuracy is high → counter-evidence should suppress both gaps
  assert(mg.active === false, "S3: Memory Gap inactive (recovered)");
  assert(cg.active === false, "S3: Concept Gap inactive (recovered)");
  assert(r.primaryDiagnosis === null, "S3: no active diagnosis (healthy)");
  console.log(`  ✓ MG=${mg.score} CG=${cg.score} primary=none (recovered)`);
}

// ─── Scenario 4: Consistently overconfident ─────────────────

section("S4: Consistently overconfident");
{
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: false, confidence: 3, timestamp: new Date("2026-07-01") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, confidence: 3, timestamp: new Date("2026-07-03") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: true, confidence: 3, timestamp: new Date("2026-07-05") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, confidence: 2, timestamp: new Date("2026-07-07") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, confidence: 3, timestamp: new Date("2026-07-09") }),
  ];
  const r = pipeline(events);
  const cal = get(r, "calibration_gap");
  assert(cal.active === true, "S4: Calibration Gap active");
  assert(cal.score >= 0.45, "S4: Calibration meaningful");
  assert(cal.explanation.includes("mismatch") || cal.explanation.includes("miscalibrated"), "S4: explains mismatch");
  console.log(`  ✓ Cal=${cal.score} active=${cal.active}`);
}

// ─── Scenario 5: Consistently underconfident ────────────────

section("S5: Consistently underconfident");
{
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: true, confidence: 1, timestamp: new Date("2026-07-01") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: true, confidence: 1, timestamp: new Date("2026-07-03") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: true, confidence: 1, timestamp: new Date("2026-07-05") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: true, confidence: 1, timestamp: new Date("2026-07-07") }),
  ];
  const r = pipeline(events);
  const cal = get(r, "calibration_gap"), cg = get(r, "concept_gap");
  assert(cal.active === true, "S5: Calibration Gap active (underconfident)");
  assert(cg.active === false, "S5: Concept Gap inactive (all correct)");
  console.log(`  ✓ Cal=${cal.score} CG=${cg.score}`);
}

// ─── Scenario 6: Repeated skipper ───────────────────────────

section("S6: Repeated revision skipper");
{
  const events = [
    ev({ eventType: "self_assessment", selfAssessment: "remembered", timestamp: new Date("2026-06-15") }),
    ev({ eventType: "skip", skipCount: 1, timestamp: new Date("2026-07-01") }),
    ev({ eventType: "skip", skipCount: 2, timestamp: new Date("2026-07-05") }),
    ev({ eventType: "skip", skipCount: 3, timestamp: new Date("2026-07-10") }),
    ev({ eventType: "skip", skipCount: 4, timestamp: new Date("2026-07-15") }),
  ];
  const r = pipeline(events);
  const rg = get(r, "revision_gap");
  assert(rg.active === true, "S6: Revision Gap active");
  assert(rg.score >= 0.35, "S6: Revision Gap meaningful");
  assert(rg.explanation.includes("Skip") || rg.explanation.includes("skip"), "S6: explains skipping");
  console.log(`  ✓ RG=${rg.score} active=${rg.active}`);
}

// ─── Scenario 7: Multi-diagnosis learner ────────────────────

section("S7: Multi-diagnosis (concept + calibration + revision)");
{
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: false, confidence: 3, selectedAnswer: "b", correctAnswer: "a", timestamp: new Date("2026-07-01") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, confidence: 3, selectedAnswer: "b", correctAnswer: "a", timestamp: new Date("2026-07-03") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, confidence: 2, selectedAnswer: "b", correctAnswer: "a", timestamp: new Date("2026-07-05") }),
    ev({ eventType: "skip", skipCount: 1, timestamp: new Date("2026-07-07") }),
    ev({ eventType: "skip", skipCount: 2, timestamp: new Date("2026-07-09") }),
    ev({ eventType: "skip", skipCount: 3, timestamp: new Date("2026-07-11") }),
  ];
  const r = pipeline(events);
  const cg = get(r, "concept_gap"), cal = get(r, "calibration_gap"), rg = get(r, "revision_gap"), mg = get(r, "memory_gap");
  assert(cg.active === true, "S7: Concept Gap active");
  assert(cal.active === true, "S7: Calibration Gap active");
  assert(rg.active === true, "S7: Revision Gap active");
  assert(mg.active === false, "S7: Memory Gap inactive (no prior success)");
  const activeCount = r.diagnoses.filter((d) => d.active).length;
  assert(activeCount === 3, "S7: 3 simultaneous diagnoses");
  assert(r.primaryDiagnosis !== null, "S7: has primary");
  console.log(`  ✓ CG=${cg.score} Cal=${cal.score} RG=${rg.score} primary=${r.primaryDiagnosis?.type}`);
}

// ─── Scenario 8: Healthy learner ────────────────────────────

section("S8: Strong learner, healthy behaviour");
{
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: true, confidence: 3, timestamp: new Date("2026-07-01") }),
    ev({ eventType: "self_assessment", selfAssessment: "remembered", timestamp: new Date("2026-07-05") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: true, confidence: 2, timestamp: new Date("2026-07-10") }),
    ev({ eventType: "self_assessment", selfAssessment: "remembered", timestamp: new Date("2026-07-15") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: true, confidence: 3, timestamp: new Date("2026-07-20") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: true, confidence: 3, timestamp: new Date("2026-08-01") }),
  ];
  const r = pipeline(events);
  assert(r.diagnoses.every((d) => d.active === false), "S8: all inactive");
  assert(r.primaryDiagnosis === null, "S8: no primary");
  console.log("  ✓ Healthy learner → no active diagnoses");
}

// ─── Scenario 9: Sparse evidence ────────────────────────────

section("S9: Sparse evidence (2 events)");
{
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: false, timestamp: new Date("2026-07-20") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, timestamp: new Date("2026-07-25") }),
  ];
  const r = pipeline(events);
  const cg = get(r, "concept_gap");
  // 2 MCQ attempts meets minimum, but score should be moderate not extreme
  assert(cg.score > 0, "S9: some Concept Gap signal");
  assert(cg.score <= 0.8, "S9: not extreme with only 2 events");
  const cal = get(r, "calibration_gap");
  assert(cal.score === 0, "S9: no calibration (no confidence data)");
  console.log(`  ✓ Sparse: CG=${cg.score} Cal=${cal.score}`);
}

// ─── Scenario 10: Long history ──────────────────────────────

section("S10: Long history (20+ events)");
{
  const events: NormalizedEvidence[] = [];
  // 10 correct events early
  for (let i = 0; i < 10; i++) {
    events.push(ev({ eventType: "mcq_attempt", mcqCorrect: true, confidence: 3,
      timestamp: new Date(`2026-05-${(i + 1).toString().padStart(2, "0")}`) }));
  }
  // 5 revision remembered
  for (let i = 0; i < 5; i++) {
    events.push(ev({ eventType: "self_assessment", selfAssessment: "remembered",
      timestamp: new Date(`2026-06-${(i + 1).toString().padStart(2, "0")}`) }));
  }
  // 5 recent failures
  for (let i = 0; i < 5; i++) {
    events.push(ev({ eventType: "mcq_attempt", mcqCorrect: false, confidence: 2,
      previousInterval: 10, newInterval: 1,
      timestamp: new Date(`2026-07-${(20 + i).toString().padStart(2, "0")}`) }));
  }
  const r = pipeline(events);
  const mg = get(r, "memory_gap");
  assert(mg.active === true, "S10: Memory Gap active (was mastered, now failing)");
  assert(r.evidenceCount === 20, "S10: all 20 events counted");
  console.log(`  ✓ Long history: MG=${mg.score} primary=${r.primaryDiagnosis?.type}`);
}

// ─── Scenario 11: Legacy evidence ───────────────────────────

section("S11: Legacy events (no R1 fields)");
{
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: true, timestamp: new Date("2026-07-01") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, timestamp: new Date("2026-07-05") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, timestamp: new Date("2026-07-10") }),
    // No confidence, no selectedAnswer, no questionId — all null
  ];
  const r = pipeline(events);
  const cg = get(r, "concept_gap"), cal = get(r, "calibration_gap");
  assert(cg.score > 0, "S11: Concept Gap scored from mcqCorrect alone");
  assert(cal.score === 0, "S11: no calibration (no confidence)");
  assert(r.diagnoses.every((d) => d.explanation.length > 0), "S11: all explanations present");
  console.log(`  ✓ Legacy: CG=${cg.score} Cal=${cal.score}`);
}

// ─── Feature Interaction: Double-Counting ───────────────────

section("Feature interaction: accuracy vs recentAccuracy");
{
  // When all events are recent, accuracy ≈ recentAccuracy
  // Both fire → verify score is not unreasonably high for modest evidence
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: false, timestamp: new Date("2026-08-01") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, timestamp: new Date("2026-08-02") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, timestamp: new Date("2026-08-03") }),
  ];
  const f = extractFeatures(events, NOW);
  assert(f.accuracy === f.recentAccuracy, "FI: accuracy = recentAccuracy when all recent");
  const r = pipeline(events);
  const cg = get(r, "concept_gap");
  // Both accuracy + recentAccuracy fire, plus consecutiveFailures
  // With current weights: 0.35 + 0.25 + 0.10*3 = 0.90 → reasonable, not over 1.0
  assert(cg.score <= 1.0, "FI: score clamped despite double signal");
  assert(cg.score >= 0.5, "FI: still meaningful");
  console.log(`  ✓ accuracy+recentAccuracy overlap: CG=${cg.score} (acceptable)`);
}

section("Feature interaction: skipCount vs skipRate");
{
  // 1 skip out of 1 revision engagement = skipRate 0.50 (> 0.40 threshold)
  // But skipCount=1 is modest
  const events = [
    ev({ eventType: "self_assessment", selfAssessment: "remembered", timestamp: new Date("2026-07-01") }),
    ev({ eventType: "skip", skipCount: 1, timestamp: new Date("2026-07-10") }),
  ];
  const r = pipeline(events);
  const rg = get(r, "revision_gap");
  // skipCount=1 → perSkip*1=0.12, skipRate>0.40 → highSkipRate=0.30
  // Total = 0.42, but counter-evidence from daysSinceLastEvent if recent
  assert(rg.score < 0.5, "FI: modest skip evidence → modest score");
  console.log(`  ✓ skipCount+skipRate overlap: RG=${rg.score} (acceptable)`);
}

// ─── Stability: Small Changes ───────────────────────────────

section("Stability: incremental evidence");
{
  const base = [
    ev({ eventType: "mcq_attempt", mcqCorrect: false, confidence: 2, timestamp: new Date("2026-07-01") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, confidence: 2, timestamp: new Date("2026-07-03") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, confidence: 2, timestamp: new Date("2026-07-05") }),
  ];
  const r1 = pipeline(base);
  // Add one more failure — score should increase but not jump dramatically
  const extended = [...base,
    ev({ eventType: "mcq_attempt", mcqCorrect: false, confidence: 2, timestamp: new Date("2026-07-07") }),
  ];
  const r2 = pipeline(extended);
  const cg1 = get(r1, "concept_gap").score, cg2 = get(r2, "concept_gap").score;
  const delta = cg2 - cg1;
  assert(delta >= 0, "Stab: score non-decreasing with more failures");
  assert(delta < 0.3, "Stab: no dramatic jump from one event");
  console.log(`  ✓ CG: ${cg1}→${cg2} (delta=${delta.toFixed(2)})`);
}

// ─── Explainability: Active Diagnoses ───────────────────────

section("Explainability deep check");
{
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: true, confidence: 3, timestamp: new Date("2026-06-01") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, confidence: 2, previousInterval: 8, newInterval: 1, timestamp: new Date("2026-07-15") }),
    ev({ eventType: "self_assessment", selfAssessment: "forgot", timestamp: new Date("2026-07-20") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, confidence: 1, timestamp: new Date("2026-07-25") }),
  ];
  const r = pipeline(events);
  for (const d of r.diagnoses) {
    assert(d.explanation.length > 10, `Expl: ${d.type} has substantive explanation`);
    if (d.active) {
      assert(d.topContributions.length > 0, `Expl: ${d.type} active → has contributions`);
      // Every contribution should have a non-empty description
      for (const c of d.topContributions) {
        assert(c.description.length > 0, `Expl: ${d.type}.contribution has description`);
        assert(typeof c.contributionWeight === "number", `Expl: ${d.type}.contribution has weight`);
      }
    }
  }
  console.log("  ✓ All explanations and contributions are substantive");
}

// ─── Config Sensitivity ─────────────────────────────────────

section("Config sensitivity");
{
  const events = [
    ev({ eventType: "mcq_attempt", mcqCorrect: false, timestamp: new Date("2026-07-01") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, timestamp: new Date("2026-07-03") }),
    ev({ eventType: "mcq_attempt", mcqCorrect: false, timestamp: new Date("2026-07-05") }),
  ];
  const f = extractFeatures(events, NOW);
  // Double the Concept Gap weights
  const strongConfig = structuredClone(DEFAULT_SCORING_CONFIG);
  strongConfig.weights.conceptGap.lowAccuracy = 0.70;
  const rDefault = diagnose(f, NOW);
  const rStrong = diagnose(f, NOW, strongConfig);
  assert(get(rStrong, "concept_gap").score > get(rDefault, "concept_gap").score,
    "Config: higher weight → higher score");
  // Other diagnoses unchanged
  assert(get(rStrong, "memory_gap").score === get(rDefault, "memory_gap").score,
    "Config: other diagnoses unaffected");
  console.log("  ✓ Weight changes affect only targeted diagnosis");
}

// ─── Summary ────────────────────────────────────────────────

section("RESULTS");
console.log(`\n  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
if (failures.length > 0) {
  console.log(`\n  Failures:`);
  failures.forEach((f) => console.log(`    - ${f}`));
}
console.log(`\n  ${failed === 0 ? "✅ R2.4 E2E VALIDATION: PASSED" : "❌ R2.4 E2E VALIDATION: ISSUES FOUND"}\n`);
process.exit(failed > 0 ? 1 : 0);
