/**
 * R3.1 — RepairRequest Builder Validation
 *
 * Tests that every failureReason produces the correct RepairRequest.
 * Validates:
 *   1. failureReason → repairIntent mapping (all 7)
 *   2. Original failureReason is preserved
 *   3. Correct conceptId is preserved
 *   4. Question context is preserved when provided
 *   5. Question context defaults to null when absent
 *   6. verificationRequired is correctly assigned
 *   7. No old R2 diagnostic score is used
 *   8. Unknown/invalid failure reasons fail safely
 *   9. requestId is generated
 *  10. status is "pending"
 *  11. createdAt is set
 *  12. getRepairIntent() utility works
 *  13. ALL_FAILURE_REASONS is complete
 *
 * Run: npx tsx src/lib/repair/__tests__/repair-request.test.ts
 */

import {
  buildRepairRequest,
  getRepairIntent,
  ALL_FAILURE_REASONS,
} from "@/lib/repair/repair-request.builder";
import type {
  RepairRequest,
  RepairIntent,
  RepairQuestionContext,
} from "@/lib/repair/repair-request.builder";
import type { FailureReason } from "@/lib/evidence/evidence.types";

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

const CONCEPT = "fundamental-rights-article-19";
const QUESTION_CTX: RepairQuestionContext = {
  questionIndex: 2,
  selectedAnswer: "b",
  correctAnswer: "d",
  questionText: "Which Article guarantees freedom of speech?",
  questionId: "q-fr-019",
};

// ─── Section 1: failureReason → repairIntent mapping ────────

section("1. failureReason → repairIntent mapping");

const EXPECTED_MAP: Record<FailureReason, RepairIntent> = {
  concept_not_understood: "concept_teaching",
  could_not_recall: "active_recall",
  misunderstood_question: "question_interpretation",
  guessed: "uncertainty_resolution",
  overconfident: "calibration",
  careless_mistake: "error_awareness",
  not_sure: "clarification",
};

for (const [reason, expectedIntent] of Object.entries(EXPECTED_MAP)) {
  const req = buildRepairRequest({
    failureReason: reason as FailureReason,
    conceptId: CONCEPT,
  });
  assert(
    req.repairIntent === expectedIntent,
    `1: ${reason} → ${expectedIntent} (got ${req.repairIntent})`
  );
}
console.log("  ✓ All 7 failure reasons map to correct repair intents");

// ─── Section 2: Original failureReason preserved ────────────

section("2. Original failureReason preserved");

for (const reason of ALL_FAILURE_REASONS) {
  const req = buildRepairRequest({
    failureReason: reason,
    conceptId: CONCEPT,
  });
  assert(
    req.failureReason === reason,
    `2: failureReason "${reason}" preserved`
  );
}
console.log("  ✓ All failure reasons preserved in RepairRequest");

// ─── Section 3: conceptId preserved ─────────────────────────

section("3. conceptId preserved");
{
  const ids = ["concept-001", "fundamental-rights", "article-356-emergency"];
  for (const id of ids) {
    const req = buildRepairRequest({
      failureReason: "concept_not_understood",
      conceptId: id,
    });
    assert(req.conceptId === id, `3: conceptId="${id}" preserved`);
  }
  console.log("  ✓ conceptId correctly preserved for all inputs");
}

// ─── Section 4: Question context preserved ──────────────────

section("4. Question context preserved when provided");
{
  const req = buildRepairRequest({
    failureReason: "misunderstood_question",
    conceptId: CONCEPT,
    questionContext: QUESTION_CTX,
  });
  assert(req.questionContext !== null, "4a: questionContext not null");
  assert(req.questionContext?.questionIndex === 2, "4b: questionIndex=2");
  assert(req.questionContext?.selectedAnswer === "b", "4c: selectedAnswer=b");
  assert(req.questionContext?.correctAnswer === "d", "4d: correctAnswer=d");
  assert(
    req.questionContext?.questionText === "Which Article guarantees freedom of speech?",
    "4e: questionText preserved"
  );
  assert(req.questionContext?.questionId === "q-fr-019", "4f: questionId preserved");
  console.log("  ✓ All question context fields preserved");
}

// ─── Section 5: Question context defaults to null ───────────

section("5. Question context defaults to null when absent");
{
  const req = buildRepairRequest({
    failureReason: "concept_not_understood",
    conceptId: CONCEPT,
  });
  assert(req.questionContext === null, "5: questionContext is null");
  console.log("  ✓ Missing question context → null");
}

// ─── Section 6: verificationRequired ────────────────────────

section("6. verificationRequired correctly assigned");
{
  // All intents require verification EXCEPT "not_sure" → clarification
  const requiresVerification: FailureReason[] = [
    "concept_not_understood",
    "could_not_recall",
    "misunderstood_question",
    "guessed",
    "overconfident",
    "careless_mistake",
  ];

  for (const reason of requiresVerification) {
    const req = buildRepairRequest({ failureReason: reason, conceptId: CONCEPT });
    assert(
      req.verificationRequired === true,
      `6a: ${reason} → verificationRequired=true`
    );
  }
  console.log("  ✓ 6 repair intents require verification");

  // not_sure → clarification does NOT require verification
  const notSureReq = buildRepairRequest({
    failureReason: "not_sure",
    conceptId: CONCEPT,
  });
  assert(
    notSureReq.verificationRequired === false,
    "6b: not_sure → verificationRequired=false"
  );
  console.log("  ✓ clarification does not require verification");
}

// ─── Section 7: No old R2 diagnostic scores ─────────────────

section("7. No old R2 diagnostic scores in RepairRequest");
{
  const req = buildRepairRequest({
    failureReason: "concept_not_understood",
    conceptId: CONCEPT,
    questionContext: QUESTION_CTX,
  });

  // RepairRequest should NOT contain diagnosis, score, DiagnosisType,
  // coexistingDiagnoses, or any R2 scoring artifact
  const reqObj = req as unknown as Record<string, unknown>;
  assert(!("diagnosis" in reqObj), "7a: no 'diagnosis' field");
  assert(!("score" in reqObj), "7b: no 'score' field");
  assert(!("coexistingDiagnoses" in reqObj), "7c: no 'coexistingDiagnoses' field");
  assert(!("diagnosisType" in reqObj), "7d: no 'diagnosisType' field");
  assert(!("context" in reqObj && typeof reqObj.context === "object" && reqObj.context !== null && "accuracy" in reqObj.context), "7e: no R2 'context.accuracy' field");

  // repairIntent should NOT be one of the old 4-gap taxonomy names
  const oldGaps = ["concept_gap", "memory_gap", "calibration_gap", "revision_gap"];
  assert(!oldGaps.includes(req.repairIntent), "7f: repairIntent is not old gap name");

  console.log("  ✓ RepairRequest contains no R2 diagnostic scoring artifacts");
}

// ─── Section 8: Unknown/invalid failure reasons ─────────────

section("8. Unknown/invalid failure reasons fail safely");
{
  let threw = false;
  try {
    buildRepairRequest({
      failureReason: "invalid_reason" as FailureReason,
      conceptId: CONCEPT,
    });
  } catch (err) {
    threw = true;
    assert(
      err instanceof Error && err.message.includes("Unknown failureReason"),
      "8a: error message mentions unknown failureReason"
    );
  }
  assert(threw, "8b: throws for invalid failureReason");

  let threw2 = false;
  try {
    buildRepairRequest({
      failureReason: "" as FailureReason,
      conceptId: CONCEPT,
    });
  } catch {
    threw2 = true;
  }
  assert(threw2, "8c: throws for empty string failureReason");

  console.log("  ✓ Invalid failure reasons throw meaningful errors");
}

// ─── Section 9: requestId generated ─────────────────────────

section("9. requestId is generated and unique");
{
  const req1 = buildRepairRequest({
    failureReason: "concept_not_understood",
    conceptId: CONCEPT,
  });
  const req2 = buildRepairRequest({
    failureReason: "concept_not_understood",
    conceptId: CONCEPT,
  });

  assert(typeof req1.requestId === "string", "9a: requestId is string");
  assert(req1.requestId.length > 0, "9b: requestId is non-empty");
  assert(req1.requestId !== req2.requestId, "9c: requestIds are unique");
  console.log("  ✓ Unique requestId generated for each request");
}

// ─── Section 10: status is "pending" ────────────────────────

section("10. status is 'pending'");
{
  for (const reason of ALL_FAILURE_REASONS) {
    const req = buildRepairRequest({ failureReason: reason, conceptId: CONCEPT });
    assert(req.status === "pending", `10: ${reason} → status=pending`);
  }
  console.log("  ✓ All requests created with status 'pending'");
}

// ─── Section 11: createdAt is set ───────────────────────────

section("11. createdAt is set");
{
  const before = new Date();
  const req = buildRepairRequest({
    failureReason: "concept_not_understood",
    conceptId: CONCEPT,
  });
  const after = new Date();

  assert(req.createdAt instanceof Date, "11a: createdAt is Date");
  assert(req.createdAt >= before, "11b: createdAt ≥ before");
  assert(req.createdAt <= after, "11c: createdAt ≤ after");
  console.log("  ✓ createdAt set to current time");
}

// ─── Section 12: getRepairIntent() utility ──────────────────

section("12. getRepairIntent() utility works");
{
  for (const [reason, expectedIntent] of Object.entries(EXPECTED_MAP)) {
    const intent = getRepairIntent(reason as FailureReason);
    assert(intent === expectedIntent, `12a: getRepairIntent(${reason}) = ${expectedIntent}`);
  }

  let threw = false;
  try {
    getRepairIntent("bogus" as FailureReason);
  } catch {
    threw = true;
  }
  assert(threw, "12b: getRepairIntent throws for invalid reason");

  console.log("  ✓ getRepairIntent() matches builder and rejects invalid input");
}

// ─── Section 13: ALL_FAILURE_REASONS is complete ────────────

section("13. ALL_FAILURE_REASONS is complete");
{
  const expected: FailureReason[] = [
    "concept_not_understood",
    "could_not_recall",
    "misunderstood_question",
    "guessed",
    "overconfident",
    "careless_mistake",
    "not_sure",
  ];
  assert(ALL_FAILURE_REASONS.length === 7, "13a: exactly 7 failure reasons");
  for (const reason of expected) {
    assert(
      ALL_FAILURE_REASONS.includes(reason),
      `13b: includes ${reason}`
    );
  }
  console.log("  ✓ ALL_FAILURE_REASONS contains all 7 values");
}

// ─── Section 14: Objective is meaningful ────────────────────

section("14. Objective is meaningful and specific");
{
  for (const reason of ALL_FAILURE_REASONS) {
    const req = buildRepairRequest({ failureReason: reason, conceptId: CONCEPT });
    assert(typeof req.objective === "string", `14a: ${reason} objective is string`);
    assert(req.objective.length > 20, `14b: ${reason} objective is substantial`);

    // Objective should NOT contain old gap taxonomy names
    const lowerObj = req.objective.toLowerCase();
    assert(
      !lowerObj.includes("concept gap") &&
      !lowerObj.includes("memory gap") &&
      !lowerObj.includes("calibration gap") &&
      !lowerObj.includes("revision gap"),
      `14c: ${reason} objective does not mention old gap names`
    );
  }
  console.log("  ✓ All objectives are meaningful and gap-name-free");
}

// ─── Section 15: Partial question context ───────────────────

section("15. Partial question context preserved");
{
  // Only some fields provided (e.g., legacy events)
  const partial: RepairQuestionContext = {
    questionIndex: 0,
    correctAnswer: "a",
  };
  const req = buildRepairRequest({
    failureReason: "guessed",
    conceptId: CONCEPT,
    questionContext: partial,
  });
  assert(req.questionContext !== null, "15a: partial context preserved");
  assert(req.questionContext?.questionIndex === 0, "15b: questionIndex=0");
  assert(req.questionContext?.correctAnswer === "a", "15c: correctAnswer=a");
  assert(req.questionContext?.selectedAnswer === undefined, "15d: selectedAnswer undefined (not provided)");
  assert(req.questionContext?.questionId === undefined, "15e: questionId undefined (not provided)");
  console.log("  ✓ Partial question context preserved correctly");
}

// ─── Section 16: Each intent is distinct ────────────────────

section("16. Each failure reason produces a distinct repairIntent");
{
  const intents = new Set<RepairIntent>();
  for (const reason of ALL_FAILURE_REASONS) {
    const req = buildRepairRequest({ failureReason: reason, conceptId: CONCEPT });
    intents.add(req.repairIntent);
  }
  assert(intents.size === 7, "16: all 7 intents are distinct");
  console.log("  ✓ 7 failure reasons → 7 distinct repair intents");
}

// ─── Section 17: No 4-gap taxonomy in repairIntent ──────────

section("17. repairIntent never uses old 4-gap taxonomy");
{
  const oldTaxonomy = [
    "concept_gap", "memory_gap", "calibration_gap", "revision_gap",
    "re_explain", "targeted_mcq", "retrieval_burst", "spaced_recall",
    "calibration_drill", "gentle_re_engagement",
  ];
  for (const reason of ALL_FAILURE_REASONS) {
    const req = buildRepairRequest({ failureReason: reason, conceptId: CONCEPT });
    assert(
      !oldTaxonomy.includes(req.repairIntent),
      `17: ${reason} intent "${req.repairIntent}" is not old taxonomy`
    );
  }
  console.log("  ✓ No old gap taxonomy or strategy names in repairIntent");
}

// ─── Summary ────────────────────────────────────────────────

section("RESULTS");

console.log(`\n  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);

if (failures.length > 0) {
  console.log(`\n  Failures:`);
  failures.forEach((f) => console.log(`    - ${f}`));
}

console.log(`\n  ${failed === 0 ? "✅ R3.1 REPAIR REQUEST BUILDER: VALIDATED" : "❌ R3.1 REPAIR REQUEST BUILDER: ISSUES FOUND"}\n`);

process.exit(failed > 0 ? 1 : 0);
