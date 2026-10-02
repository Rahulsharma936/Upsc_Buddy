/**
 * R2.3 Diagnostic Scoring Engine Validation
 *
 * Tests all scoring behaviors: individual diagnoses, coexistence,
 * counter-evidence, eligibility, thresholds, ranking, and
 * realistic mixed learning histories.
 *
 * Run: npx tsx src/lib/diagnostic/__tests__/diagnostic-engine.test.ts
 */

import { diagnose, DEFAULT_SCORING_CONFIG } from "@/lib/diagnostic/diagnostic.engine";
import type { ConceptFeatures } from "@/lib/diagnostic/feature.types";
import type { ScoringConfig, DiagnosisType } from "@/lib/diagnostic/diagnostic.types";

// ─── Test Helpers ─────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];
const NOW = new Date("2026-08-04T12:00:00Z");

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

/** Create a minimal ConceptFeatures object with overrides. */
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

// ─── No Evidence ────────────────────────────────────────────

section("No evidence (empty features)");

{
  const r = diagnose(feat(), NOW);
  assert(r.diagnoses.length === 4, "NoEv: all 4 diagnoses present");
  assert(r.diagnoses.every((d) => d.active === false), "NoEv: all inactive");
  assert(r.diagnoses.every((d) => d.score === 0), "NoEv: all scores=0");
  assert(r.primaryDiagnosis === null, "NoEv: no primary");
  assert(r.evidenceCount === 0, "NoEv: evidenceCount=0");
  assert(r.generatedAt.getTime() === NOW.getTime(), "NoEv: timestamp");

  // Explanations should exist
  assert(r.diagnoses.every((d) => d.explanation.length > 0), "NoEv: all have explanations");
  console.log("  ✓ Empty features → all inactive, score=0, no primary");
}

// ─── Concept Gap: Independent ───────────────────────────────

section("Concept Gap: independent scoring");

{
  // Strong concept gap: low accuracy, consecutive failures, repeated wrong answer
  const f = feat({
    totalEvents: 6,
    mcqAttemptCount: 6,
    accuracy: 0.17,       // 1/6
    recentAccuracy: 0.0,  // 0/5 recent
    consecutiveFailures: 4,
    hasRepeatedWrongAnswer: true,
  });
  const r = diagnose(f, NOW);
  const cg = getDiagnosis(r, "concept_gap");

  assert(cg.active === true, "CG: active with strong signals");
  assert(cg.score > 0.5, "CG: high score");
  assert(cg.topContributions.length > 0, "CG: has contributions");
  assert(cg.explanation.length > 0, "CG: has explanation");

  // Verify feature contributions are present
  const featureNames = cg.topContributions.map((c) => c.featureName);
  assert(featureNames.includes("accuracy"), "CG: accuracy contributed");
  assert(featureNames.includes("consecutiveFailures"), "CG: consecutive failures contributed");
  assert(featureNames.includes("hasRepeatedWrongAnswer"), "CG: repeated wrong contributed");

  console.log(`  ✓ Strong Concept Gap: score=${cg.score}, active=${cg.active}`);
}

{
  // Weak concept gap: borderline accuracy
  const f = feat({
    totalEvents: 4,
    mcqAttemptCount: 4,
    accuracy: 0.50,     // exactly at threshold
    recentAccuracy: 0.50,
  });
  const r = diagnose(f, NOW);
  const cg = getDiagnosis(r, "concept_gap");
  // Accuracy at threshold → no low-accuracy contribution, counter-evidence kicks in
  assert(cg.score === 0, "CG: score=0 at threshold (counter-evidence)");
  assert(cg.active === false, "CG: inactive at threshold");
  console.log("  ✓ Borderline accuracy → Concept Gap inactive");
}

{
  // Too few attempts → no scoring
  const f = feat({
    totalEvents: 1,
    mcqAttemptCount: 1,
    accuracy: 0.0,
  });
  const r = diagnose(f, NOW);
  const cg = getDiagnosis(r, "concept_gap");
  assert(cg.score === 0, "CG: 1 attempt → score=0");
  assert(cg.active === false, "CG: 1 attempt → inactive");
  console.log("  ✓ Single MCQ attempt → no Concept Gap (min threshold)");
}

// ─── Memory Gap: Independent ────────────────────────────────

section("Memory Gap: independent scoring");

{
  // Strong memory gap: had success, now decaying
  const f = feat({
    totalEvents: 8,
    mcqAttemptCount: 5,
    revisionAttemptCount: 3,
    accuracy: 0.60,
    recentAccuracy: 0.20,     // decline from 0.60
    hasSuccessHistory: true,
    daysSinceLastSuccess: 25, // > 7 day threshold
    intervalDecreasing: true,
    recallSuccessRate: 0.33,  // < 0.50 threshold
  });
  const r = diagnose(f, NOW);
  const mg = getDiagnosis(r, "memory_gap");

  assert(mg.active === true, "MG: active with strong decay signals");
  assert(mg.score > 0.4, "MG: meaningful score");

  const featureNames = mg.topContributions.map((c) => c.featureName);
  assert(featureNames.includes("daysSinceLastSuccess"), "MG: days since success contributed");
  assert(featureNames.includes("intervalDecreasing"), "MG: interval contributed");
  assert(featureNames.includes("recallSuccessRate"), "MG: recall rate contributed");

  console.log(`  ✓ Strong Memory Gap: score=${mg.score}, active=${mg.active}`);
}

{
  // Memory Gap INELIGIBLE: no success history
  const f = feat({
    totalEvents: 5,
    mcqAttemptCount: 5,
    accuracy: 0.0,
    hasSuccessHistory: false, // never demonstrated learning
    daysSinceLastSuccess: null,
  });
  const r = diagnose(f, NOW);
  const mg = getDiagnosis(r, "memory_gap");
  assert(mg.score === 0, "MG: ineligible → score=0");
  assert(mg.active === false, "MG: ineligible → inactive");
  assert(mg.explanation.includes("prior"), "MG: explanation mentions prior learning");
  console.log("  ✓ No success history → Memory Gap ineligible");
}

{
  // Counter-evidence: recent accuracy is high
  const f = feat({
    totalEvents: 6,
    mcqAttemptCount: 4,
    revisionAttemptCount: 2,
    accuracy: 0.75,
    recentAccuracy: 0.80,   // above 0.75 → counter-evidence
    hasSuccessHistory: true,
    daysSinceLastSuccess: 2,
    recallSuccessRate: 0.80,
  });
  const r = diagnose(f, NOW);
  const mg = getDiagnosis(r, "memory_gap");
  assert(mg.score === 0, "MG: counter-evidence → score=0");
  assert(mg.active === false, "MG: counter-evidence → inactive");
  console.log("  ✓ High recent accuracy → Memory Gap reduced to 0");
}

// ─── Calibration Gap: Independent ───────────────────────────

section("Calibration Gap: independent scoring");

{
  // Strong calibration gap: high mismatch rate
  const f = feat({
    totalEvents: 5,
    mcqAttemptCount: 5,
    accuracy: 0.40,
    confidenceMismatchRate: 0.60, // > 0.30 threshold
    eventsWithConfidence: 5,
  });
  const r = diagnose(f, NOW);
  const cal = getDiagnosis(r, "calibration_gap");

  assert(cal.active === true, "Cal: active with high mismatch");
  assert(cal.score > 0.4, "Cal: meaningful score");

  const featureNames = cal.topContributions.map((c) => c.featureName);
  assert(featureNames.includes("confidenceMismatchRate"), "Cal: mismatch rate contributed");

  console.log(`  ✓ Strong Calibration Gap: score=${cal.score}, active=${cal.active}`);
}

{
  // No confidence data → no calibration scoring
  const f = feat({
    totalEvents: 5,
    mcqAttemptCount: 5,
    eventsWithConfidence: 0,
  });
  const r = diagnose(f, NOW);
  const cal = getDiagnosis(r, "calibration_gap");
  assert(cal.score === 0, "Cal: no confidence data → score=0");
  assert(cal.active === false, "Cal: no confidence data → inactive");
  console.log("  ✓ No confidence data → Calibration Gap not scored");
}

{
  // Too few confidence events
  const f = feat({
    totalEvents: 5,
    mcqAttemptCount: 5,
    confidenceMismatchRate: 1.0,
    eventsWithConfidence: 1, // below min=2
  });
  const r = diagnose(f, NOW);
  const cal = getDiagnosis(r, "calibration_gap");
  assert(cal.score === 0, "Cal: 1 confidence event → score=0");
  console.log("  ✓ Single confidence event → Calibration Gap not scored");
}

{
  // Counter-evidence: well calibrated
  const f = feat({
    totalEvents: 5,
    mcqAttemptCount: 5,
    confidenceMismatchRate: 0.20, // below 0.30 threshold
    eventsWithConfidence: 5,
  });
  const r = diagnose(f, NOW);
  const cal = getDiagnosis(r, "calibration_gap");
  // perMismatchEvent contributes (1 mismatch) but counter-evidence from aligned should zero it
  assert(cal.active === false, "Cal: well calibrated → inactive");
  console.log("  ✓ Well calibrated → Calibration Gap inactive");
}

// ─── Revision Gap: Independent ──────────────────────────────

section("Revision Gap: independent scoring");

{
  // Strong revision gap: many skips, high rate, inactive
  const f = feat({
    totalEvents: 5,
    revisionAttemptCount: 1,
    skipCount: 4,
    skipRate: 0.80,          // > 0.40 threshold
    daysSinceLastEvent: 20,  // > 7 day threshold
  });
  const r = diagnose(f, NOW);
  const rg = getDiagnosis(r, "revision_gap");

  assert(rg.active === true, "RG: active with strong skip signals");
  assert(rg.score > 0.5, "RG: high score");

  const featureNames = rg.topContributions.map((c) => c.featureName);
  assert(featureNames.includes("skipCount"), "RG: skipCount contributed");
  assert(featureNames.includes("skipRate"), "RG: skipRate contributed");
  assert(featureNames.includes("daysSinceLastEvent"), "RG: inactivity contributed");

  console.log(`  ✓ Strong Revision Gap: score=${rg.score}, active=${rg.active}`);
}

{
  // Counter-evidence: recent engagement
  const f = feat({
    totalEvents: 3,
    mcqAttemptCount: 2,
    revisionAttemptCount: 1,
    skipCount: 1,
    skipRate: 0.50,
    daysSinceLastEvent: 1, // recent = counter-evidence
  });
  const r = diagnose(f, NOW);
  const rg = getDiagnosis(r, "revision_gap");
  assert(rg.score < 0.35, "RG: reduced by recent engagement");
  console.log(`  ✓ Recent engagement reduces Revision Gap: score=${rg.score}`);
}

// ─── Multiple Diagnoses Coexist ─────────────────────────────

section("Multiple diagnoses coexist");

{
  // Concept Gap + Calibration Gap: confidently wrong
  const f = feat({
    totalEvents: 6,
    mcqAttemptCount: 6,
    accuracy: 0.17,
    recentAccuracy: 0.0,
    consecutiveFailures: 5,
    hasRepeatedWrongAnswer: true,
    confidenceMismatchRate: 0.80,
    eventsWithConfidence: 5,
  });
  const r = diagnose(f, NOW);
  const cg = getDiagnosis(r, "concept_gap");
  const cal = getDiagnosis(r, "calibration_gap");

  assert(cg.active === true, "Multi: Concept Gap active");
  assert(cal.active === true, "Multi: Calibration Gap active");
  assert(r.primaryDiagnosis !== null, "Multi: has primary");

  console.log(`  ✓ Concept Gap (${cg.score}) + Calibration Gap (${cal.score}) coexist`);
}

{
  // Memory Gap + Revision Gap: forgot and skipping
  const f = feat({
    totalEvents: 8,
    mcqAttemptCount: 3,
    revisionAttemptCount: 2,
    accuracy: 0.67,
    recentAccuracy: 0.33,
    hasSuccessHistory: true,
    daysSinceLastSuccess: 20,
    intervalDecreasing: true,
    recallSuccessRate: 0.30,
    skipCount: 3,
    skipRate: 0.60,
    daysSinceLastEvent: 14,
  });
  const r = diagnose(f, NOW);
  const mg = getDiagnosis(r, "memory_gap");
  const rg = getDiagnosis(r, "revision_gap");

  assert(mg.active === true, "Multi: Memory Gap active");
  assert(rg.active === true, "Multi: Revision Gap active");

  console.log(`  ✓ Memory Gap (${mg.score}) + Revision Gap (${rg.score}) coexist`);
}

// ─── Primary Diagnosis Selection ────────────────────────────

section("Primary diagnosis selection");

{
  // Two active: primary should be the higher score
  const f = feat({
    totalEvents: 8,
    mcqAttemptCount: 6,
    revisionAttemptCount: 2,
    accuracy: 0.17,
    recentAccuracy: 0.0,
    consecutiveFailures: 5,
    hasRepeatedWrongAnswer: true,
    skipCount: 3,
    skipRate: 0.60,
  });
  const r = diagnose(f, NOW);
  assert(r.primaryDiagnosis !== null, "Primary: exists when active diagnoses");
  
  const activeDiags = r.diagnoses.filter((d) => d.active);
  if (activeDiags.length > 1) {
    const maxScore = Math.max(...activeDiags.map((d) => d.score));
    assert(r.primaryDiagnosis!.score === maxScore, "Primary: highest score selected");
  }
  console.log(`  ✓ Primary = ${r.primaryDiagnosis?.type} (score=${r.primaryDiagnosis?.score})`);
}

{
  // No active diagnoses → null primary
  const f = feat({
    totalEvents: 5,
    mcqAttemptCount: 5,
    accuracy: 0.80,
    recentAccuracy: 0.80,
    hasSuccessHistory: true,
    daysSinceLastSuccess: 1,
  });
  const r = diagnose(f, NOW);
  assert(r.primaryDiagnosis === null, "Primary: null when no active");
  console.log("  ✓ No active diagnoses → primaryDiagnosis=null");
}

// ─── Counter-Evidence Reduces Scores ────────────────────────

section("Counter-evidence reducing scores");

{
  // Good accuracy should reduce Concept Gap even with consecutive failures
  const f = feat({
    totalEvents: 6,
    mcqAttemptCount: 6,
    accuracy: 0.67,       // above threshold → counter-evidence
    recentAccuracy: 0.60, // above threshold → counter-evidence
    consecutiveFailures: 2,
  });
  const r = diagnose(f, NOW);
  const cg = getDiagnosis(r, "concept_gap");
  // Consecutive failures add but counter-evidence reduces
  assert(cg.score < 0.4, "Counter: good accuracy reduces Concept Gap");
  console.log(`  ✓ Good accuracy + failures: Concept Gap score=${cg.score}`);
}

// ─── Threshold Boundaries ───────────────────────────────────

section("Threshold boundaries");

{
  // Custom config with lower threshold
  const lowThresholdConfig: ScoringConfig = {
    ...DEFAULT_SCORING_CONFIG,
    thresholds: {
      ...DEFAULT_SCORING_CONFIG.thresholds,
      activation: {
        concept_gap: 0.10,  // very low
        memory_gap: 0.10,
        calibration_gap: 0.10,
        revision_gap: 0.10,
      },
    },
  };

  const f = feat({
    totalEvents: 3,
    mcqAttemptCount: 3,
    accuracy: 0.33,
    recentAccuracy: 0.33,
    consecutiveFailures: 1,
  });

  const rDefault = diagnose(f, NOW);
  const rLow = diagnose(f, NOW, lowThresholdConfig);
  const cgDefault = getDiagnosis(rDefault, "concept_gap");
  const cgLow = getDiagnosis(rLow, "concept_gap");

  // Same score, different activation
  assert(cgDefault.score === cgLow.score, "Thresh: same score with different config");
  assert(cgLow.active === true, "Thresh: active with low threshold");

  console.log("  ✓ Custom thresholds change activation, not scoring");
}

// ─── Score Clamping ─────────────────────────────────────────

section("Score clamping");

{
  // Extreme features should still produce score ≤ 1.0
  const f = feat({
    totalEvents: 20,
    mcqAttemptCount: 20,
    accuracy: 0.0,
    recentAccuracy: 0.0,
    consecutiveFailures: 20,
    hasRepeatedWrongAnswer: true,
  });
  const r = diagnose(f, NOW);
  const cg = getDiagnosis(r, "concept_gap");
  assert(cg.score <= 1.0, "Clamp: score ≤ 1.0");
  assert(cg.score >= 0.0, "Clamp: score ≥ 0.0");
  console.log(`  ✓ Extreme features → clamped score=${cg.score}`);
}

// ─── Conflicting Evidence ───────────────────────────────────

section("Conflicting evidence");

{
  // Good overall accuracy but recent failures — Concept Gap low, Memory Gap possible
  const f = feat({
    totalEvents: 10,
    mcqAttemptCount: 8,
    revisionAttemptCount: 2,
    accuracy: 0.75,       // good overall → counter-evidence for CG
    recentAccuracy: 0.20, // recent decline → signals MG
    hasSuccessHistory: true,
    daysSinceLastSuccess: 10,
    consecutiveFailures: 3,
    intervalDecreasing: true,
    recallSuccessRate: 0.50,
  });
  const r = diagnose(f, NOW);
  const cg = getDiagnosis(r, "concept_gap");
  const mg = getDiagnosis(r, "memory_gap");

  // CG should be low due to counter-evidence from good overall accuracy
  assert(cg.score < mg.score, "Conflict: Memory Gap > Concept Gap when accuracy was historically good");
  console.log(`  ✓ Good history + recent decline → MG(${mg.score}) > CG(${cg.score})`);
}

// ─── Realistic Mixed History ────────────────────────────────

section("Realistic mixed learning history");

{
  // Student who was doing well, stopped studying, came back and is struggling
  const f = feat({
    totalEvents: 12,
    mcqAttemptCount: 7,
    revisionAttemptCount: 3,
    accuracy: 0.57,         // 4/7 — was better before
    recentAccuracy: 0.20,   // recent: 1/5 — sharp decline
    hasSuccessHistory: true,
    daysSinceLastSuccess: 15,
    consecutiveFailures: 3,
    hasRepeatedWrongAnswer: false,
    intervalDecreasing: true,
    confidenceMismatchRate: 0.40,
    eventsWithConfidence: 5,
    recallSuccessRate: 0.33,
    skipCount: 2,
    skipRate: 0.40,
    daysSinceLastEvent: 2,
  });
  const r = diagnose(f, NOW);

  // Should see Memory Gap (decline) and potentially Calibration Gap
  const mg = getDiagnosis(r, "memory_gap");
  const cal = getDiagnosis(r, "calibration_gap");
  const cg = getDiagnosis(r, "concept_gap");
  const rg = getDiagnosis(r, "revision_gap");

  assert(mg.active === true, "Real: Memory Gap active (decay)");
  assert(cg.active === true, "Real: Concept Gap active (low recent accuracy)");
  assert(r.primaryDiagnosis !== null, "Real: has primary diagnosis");

  // Report structure
  assert(r.diagnoses.length === 4, "Real: all 4 diagnoses");
  assert(r.evidenceCount === 12, "Real: evidence count");

  // Explanations should be non-empty for active diagnoses
  for (const d of r.diagnoses) {
    assert(d.explanation.length > 0, `Real: ${d.type} has explanation`);
  }

  console.log("  ✓ Realistic history produces meaningful multi-diagnosis report:");
  for (const d of r.diagnoses) {
    console.log(`    ${d.type}: score=${d.score} active=${d.active}`);
  }
  console.log(`    primary=${r.primaryDiagnosis?.type}`);
}

// ─── Explanation Quality ────────────────────────────────────

section("Explanation quality");

{
  // Active diagnosis should have specific feature mentions
  const f = feat({
    totalEvents: 6,
    mcqAttemptCount: 6,
    accuracy: 0.17,
    recentAccuracy: 0.0,
    consecutiveFailures: 5,
    hasRepeatedWrongAnswer: true,
  });
  const r = diagnose(f, NOW);
  const cg = getDiagnosis(r, "concept_gap");
  assert(cg.explanation.includes("MCQ"), "Expl: mentions MCQ");
  assert(cg.explanation.includes("accuracy") || cg.explanation.includes("failures"), "Expl: mentions accuracy or failures");
  console.log("  ✓ Active diagnosis explanations reference specific features");
}

{
  // Insufficient data should explain why
  const f = feat({ totalEvents: 0 });
  const r = diagnose(f, NOW);
  const cg = getDiagnosis(r, "concept_gap");
  assert(cg.explanation.includes("MCQ") || cg.explanation.includes("attempt"), "Expl: insufficient data mentions MCQ");
  const mg = getDiagnosis(r, "memory_gap");
  assert(mg.explanation.includes("prior") || mg.explanation.includes("previous"), "Expl: insufficient data mentions prior learning");
  console.log("  ✓ Insufficient data explanations are informative");
}

// ─── Top Contributions Bounded ──────────────────────────────

section("Top contributions bounded");

{
  const f = feat({
    totalEvents: 20,
    mcqAttemptCount: 20,
    accuracy: 0.0,
    recentAccuracy: 0.0,
    consecutiveFailures: 10,
    hasRepeatedWrongAnswer: true,
  });
  const r = diagnose(f, NOW);
  const cg = getDiagnosis(r, "concept_gap");
  assert(cg.topContributions.length <= 5, "Bounded: ≤5 contributions");
  // Contributions sorted by |weight| descending
  for (let i = 0; i < cg.topContributions.length - 1; i++) {
    const a = Math.abs(cg.topContributions[i].contributionWeight);
    const b = Math.abs(cg.topContributions[i + 1].contributionWeight);
    assert(a >= b, `Bounded: sorted by |weight| at index ${i}`);
  }
  console.log("  ✓ Top contributions bounded and sorted");
}

// ─── Determinism ────────────────────────────────────────────

section("Determinism");

{
  const f = feat({
    totalEvents: 10,
    mcqAttemptCount: 7,
    accuracy: 0.43,
    recentAccuracy: 0.20,
    consecutiveFailures: 3,
    hasSuccessHistory: true,
    daysSinceLastSuccess: 12,
    intervalDecreasing: true,
    confidenceMismatchRate: 0.50,
    eventsWithConfidence: 4,
    skipCount: 2,
    skipRate: 0.33,
    daysSinceLastEvent: 5,
  });

  const r1 = diagnose(f, NOW);
  const r2 = diagnose(f, NOW);

  for (const type of ["concept_gap", "memory_gap", "calibration_gap", "revision_gap"] as DiagnosisType[]) {
    const d1 = getDiagnosis(r1, type);
    const d2 = getDiagnosis(r2, type);
    assert(d1.score === d2.score, `Determ: ${type} same score`);
    assert(d1.active === d2.active, `Determ: ${type} same active`);
    assert(d1.explanation === d2.explanation, `Determ: ${type} same explanation`);
  }
  console.log("  ✓ Same input → identical output (deterministic)");
}

// ─── Summary ────────────────────────────────────────────────

section("RESULTS");

console.log(`\n  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);

if (failures.length > 0) {
  console.log(`\n  Failures:`);
  failures.forEach((f) => console.log(`    - ${f}`));
}

console.log(`\n  ${failed === 0 ? "✅ R2.3 DIAGNOSTIC ENGINE: VALIDATED" : "❌ R2.3 DIAGNOSTIC ENGINE: ISSUES FOUND"}\n`);

process.exit(failed > 0 ? 1 : 0);
