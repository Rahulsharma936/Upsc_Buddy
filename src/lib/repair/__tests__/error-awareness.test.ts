/**
 * R3.9 — Error Awareness Executor Validation
 *
 * Deterministic tests for the repair that serves `careless_mistake`.
 *
 * Tests:
 *   Section 1: Intent mapping and guard
 *   Section 2: Repair generation and structure (AI client stubbed)
 *   Section 3: Prompt targeting + the no-diagnosis rule
 *   Section 4: Malformed AI output and provider failure
 *   Section 5: Routing through the EXISTING /api/repair endpoint
 *   Section 6: Compatibility with the EXISTING verification + next-action flow
 *   Section 7: All six executors coexist and guard each other
 *   Section 8: Isolation — no SM-2, no legacy R2, no persistence, no diagnosis
 *
 * The AI CLIENT is stubbed; the real validation pipeline runs untouched.
 * No database, no network.
 *
 * Run: npx tsx src/lib/repair/__tests__/error-awareness.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRepairRequest, ALL_FAILURE_REASONS } from "@/lib/repair/repair-request.builder";
import type { RepairRequest, RepairQuestionContext } from "@/lib/repair/repair-request.builder";
import {
  validateRepairVerification,
  buildRepairVerificationEvent,
  VERIFIABLE_REPAIR_INTENTS,
} from "@/lib/repair/repair-verification";
import { deriveRepairContext } from "@/lib/repair/repair-understanding";
import { decideNextAction } from "@/lib/repair/repair-next-action";
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

const CONCEPT_ID = "9a8b7c6d-5e4f-4a3b-9c8d-123456789abc";
const QUESTION_CTX: RepairQuestionContext = {
  questionIndex: 1,
  selectedAnswer: "c",
  correctAnswer: "a",
  questionText: "Which of the following is NOT a feature of the Indian Constitution?",
  questionId: "q-polity-012",
};

// ─── AI client stub ─────────────────────────────────────────

const aiState = {
  content: "" as string,
  calls: [] as { prompt: string; systemPrompt: string; format?: string }[],
  throwError: null as Error | null,
};

function stubModule(spec: string, exports: Record<string, unknown>): void {
  const resolved = require.resolve(spec);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as never;
}

stubModule("@/lib/ai/client", {
  executeWithRetry: async (req: { prompt: string; systemPrompt: string }) => {
    aiState.calls.push(req as never);
    if (aiState.throwError) throw aiState.throwError;
    return { content: aiState.content, attempts: 1 };
  },
});

const routeState = {
  user: { id: "user-1" } as { id: string } | null,
  concept: {
    userId: "user-1",
    name: "features-of-constitution",
    displayName: "Features of Indian Constitution",
    subject: "Polity",
    keywords: ["Federal", "Unitary", "Quasi-federal"],
  } as Record<string, unknown> | undefined,
};

stubModule("@/lib/supabase/server", {
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: routeState.user } }) },
  }),
});

stubModule("@/lib/repositories/concept.repository", {
  conceptRepository: { findById: async () => routeState.concept },
});

/* eslint-disable @typescript-eslint/no-require-imports */
const { executeErrorAwareness } = require("@/lib/repair/error-awareness.executor") as typeof import("@/lib/repair/error-awareness.executor");
const { executeConceptTeaching } = require("@/lib/repair/concept-teaching.executor") as typeof import("@/lib/repair/concept-teaching.executor");
const { executeActiveRecall } = require("@/lib/repair/active-recall.executor") as typeof import("@/lib/repair/active-recall.executor");
const { executeQuestionInterpretation } = require("@/lib/repair/question-interpretation.executor") as typeof import("@/lib/repair/question-interpretation.executor");
const { executeUncertaintyResolution } = require("@/lib/repair/uncertainty-resolution.executor") as typeof import("@/lib/repair/uncertainty-resolution.executor");
const { executeCalibration } = require("@/lib/repair/calibration.executor") as typeof import("@/lib/repair/calibration.executor");
const repairRoute = require("@/app/api/repair/route") as { POST: (req: unknown) => Promise<Response> };
const { NextRequest } = require("next/server") as { NextRequest: new (url: string, init: RequestInit) => unknown };
/* eslint-enable @typescript-eslint/no-require-imports */

const VERIFICATION_FIXTURE = {
  question: "Which of the following statements about the Indian federal structure is INCORRECT?",
  options: {
    a: "The Constitution provides for a single citizenship",
    b: "Residuary powers rest with the Union",
    c: "States can secede from the Indian Union",
    d: "The judiciary is independent of the executive",
  },
  correctAnswer: "c",
  explanation: "States cannot secede from the Indian Union — India's federal structure does not permit secession.",
};

const GOOD_RESPONSE = {
  whatWasOverlooked: "The question asked for something that is NOT a feature. You likely identified a correct feature and selected it, missing the negation in the stem.",
  theTrap: "Questions with 'NOT' or 'EXCEPT' are easy to misread because the mind naturally scans for correct statements. When all options look factually accurate, the negation is the only thing that decides the answer.",
  checkingStep: "Before looking at the options, underline or mentally highlight the word NOT in the question stem. Then test each option against 'Is this FALSE about the Indian Constitution?' rather than 'Is this TRUE?'",
  patternAwareness: "Watch for negation words (NOT, EXCEPT, INCORRECT, LEAST) in UPSC questions. They invert what you are looking for and are the most common source of careless errors.",
  verification: VERIFICATION_FIXTURE,
};

function carelessRequest(ctx: RepairQuestionContext | null = QUESTION_CTX): RepairRequest {
  return buildRepairRequest({
    failureReason: "careless_mistake",
    conceptId: CONCEPT_ID,
    questionContext: ctx ?? undefined,
  });
}

function executorInput(request: RepairRequest) {
  return {
    request,
    conceptName: "Features of Indian Constitution",
    conceptSubject: "Polity",
    conceptKeywords: ["Federal", "Unitary", "Quasi-federal"],
  };
}

function resetAI(content: unknown = GOOD_RESPONSE): void {
  aiState.content = typeof content === "string" ? content : JSON.stringify(content);
  aiState.calls = [];
  aiState.throwError = null;
}

// ─── 1. Intent mapping and guard ────────────────────────────

section("1. Intent mapping and guard");
{
  const req = carelessRequest();
  assert(req.failureReason === "careless_mistake", "1a: failureReason preserved verbatim");
  assert(req.repairIntent === "error_awareness", "1b: maps to error_awareness");
  assert(req.repairIntent !== "concept_teaching", "1c: NOT converted to concept teaching");
  assert(req.repairIntent !== "calibration", "1d: NOT converted to calibration");
  assert(typeof req.requestId === "string" && req.requestId.length > 0, "1e: requestId minted");
  assert(
    VERIFIABLE_REPAIR_INTENTS.includes("error_awareness"),
    "1f: error_awareness is verifiable now it has an executor",
  );

  const expected: Record<string, string> = {
    concept_not_understood: "concept_teaching",
    could_not_recall: "active_recall",
    misunderstood_question: "question_interpretation",
    guessed: "uncertainty_resolution",
    overconfident: "calibration",
    careless_mistake: "error_awareness",
    not_sure: "clarification",
  };
  for (const reason of ALL_FAILURE_REASONS as FailureReason[]) {
    assert(
      buildRepairRequest({ failureReason: reason, conceptId: CONCEPT_ID }).repairIntent === expected[reason],
      `1g: ${reason} → ${expected[reason]} unchanged`,
    );
  }

  console.log("  ✓ careless_mistake routes to error_awareness; no gap inferred");
}

// ─── 2. Repair generation and structure ─────────────────────

async function section2() {
  section("2. Repair generation and structure");

  resetAI();
  const req = carelessRequest();
  const repair = await executeErrorAwareness(executorInput(req));

  assert(repair.requestId === req.requestId, "2a: requestId preserved");
  assert(repair.conceptId === CONCEPT_ID, "2b: conceptId preserved");
  assert(repair.failureReason === "careless_mistake", "2c: failureReason unconverted");
  assert(repair.repairIntent === "error_awareness", "2d: repairIntent unconverted");
  assert(repair.questionContext?.questionId === "q-polity-012", "2e: question context preserved");
  assert(repair.questionContext?.selectedAnswer === "c", "2f: the careless selection preserved");
  assert(repair.status === "ready", "2g: status ready");
  assert(repair.generatedAt instanceof Date, "2h: generatedAt is a Date");

  assert(repair.breakdown.whatWasOverlooked === GOOD_RESPONSE.whatWasOverlooked, "2i: whatWasOverlooked returned");
  assert(repair.breakdown.theTrap === GOOD_RESPONSE.theTrap, "2j: theTrap returned");
  assert(repair.breakdown.checkingStep === GOOD_RESPONSE.checkingStep, "2k: checkingStep returned");
  assert(repair.breakdown.patternAwareness === GOOD_RESPONSE.patternAwareness, "2l: patternAwareness returned");

  const asRecord = repair as unknown as Record<string, unknown>;
  assert(!("explanation" in asRecord), "2m: no concept-teaching explanation block");
  assert(!("retrieval" in asRecord), "2n: no active-recall retrieval block");

  const serialized = JSON.stringify(repair);
  for (const token of ["concept_gap", "memory_gap", "calibration_gap", "diagnosis", "resolved"]) {
    assert(!serialized.includes(token), `2o: output carries no "${token}"`);
  }

  assert(Object.keys(repair.verification.options).length === 4, "2p: four verification options");
  assert(repair.verification.correctAnswer === "c", "2q: verification answer key returned");
  assert(
    repair.verification.question !== QUESTION_CTX.questionText,
    "2r: verification differs from the original question",
  );

  resetAI({ ...GOOD_RESPONSE, checkingStep: null });
  const noContext = await executeErrorAwareness(executorInput(carelessRequest(null)));
  assert(noContext.breakdown.checkingStep === null, "2s: checkingStep may be null");
  assert(noContext.questionContext === null, "2t: null question context preserved");

  resetAI();
  let guarded = false;
  try {
    await executeErrorAwareness(
      executorInput(buildRepairRequest({ failureReason: "could_not_recall", conceptId: CONCEPT_ID })),
    );
  } catch (err) {
    guarded = err instanceof Error && err.message.includes("error_awareness");
  }
  assert(guarded, "2u: executor rejects a foreign intent");
  assert(aiState.calls.length === 0, "2v: the guard fires before any AI call");

  console.log("  ✓ Error awareness breakdown generated; no gap invented");
}

// ─── 3. Prompt targeting + no-diagnosis rule ────────────────

async function section3() {
  section("3. Prompt targeting and the no-diagnosis rule");

  resetAI();
  await executeErrorAwareness(executorInput(carelessRequest()));

  assert(aiState.calls.length === 1, "3a: exactly one AI call");
  const { prompt, systemPrompt } = aiState.calls[0];

  assert(prompt.includes("Features of Indian Constitution"), "3b: concept name in the prompt");
  assert(prompt.includes("Federal"), "3c: keywords in the prompt");
  assert(prompt.includes(QUESTION_CTX.questionText!), "3d: failed question text in the prompt");
  assert(prompt.includes("Student carelessly selected: c"), "3e: the careless selection in the prompt");
  assert(prompt.includes("Correct answer: a"), "3f: correct answer in the prompt");
  assert(prompt.includes("I made a careless mistake"), "3g: the student's own words are quoted");

  assert(systemPrompt.includes("Do NOT diagnose the student"), "3h: system prompt forbids diagnosis");
  assert(systemPrompt.includes("Do NOT reteach the concept"), "3i: system prompt forbids reteaching");
  assert(systemPrompt.includes("PROCESS ERROR"), "3j: system prompt targets the process error");
  assert(aiState.calls[0].format === "json", "3k: JSON format requested");

  resetAI();
  await executeErrorAwareness(executorInput(carelessRequest(null)));
  assert(
    aiState.calls[0].prompt.includes("Do NOT invent an oversight"),
    "3l: missing context forbids inventing an oversight",
  );
  assert(!aiState.calls[0].prompt.includes("Student carelessly selected:"), "3m: no selection invented");

  console.log("  ✓ Prompt targets the process error without diagnosing");
}

// ─── 4. Malformed AI output and provider failure ────────────

async function section4() {
  section("4. Malformed AI output and provider failure");

  const bad: { label: string; payload: unknown }[] = [
    { label: "not JSON at all", payload: "Sorry, I can't." },
    { label: "empty string", payload: "" },
    { label: "missing whatWasOverlooked", payload: { ...GOOD_RESPONSE, whatWasOverlooked: undefined } },
    { label: "missing theTrap", payload: { ...GOOD_RESPONSE, theTrap: undefined } },
    { label: "missing patternAwareness", payload: { ...GOOD_RESPONSE, patternAwareness: undefined } },
    { label: "missing verification", payload: { ...GOOD_RESPONSE, verification: undefined } },
    { label: "whatWasOverlooked too short", payload: { ...GOOD_RESPONSE, whatWasOverlooked: "eh" } },
    { label: "patternAwareness too long", payload: { ...GOOD_RESPONSE, patternAwareness: "x".repeat(801) } },
    { label: "invalid answer key", payload: { ...GOOD_RESPONSE, verification: { ...VERIFICATION_FIXTURE, correctAnswer: "e" } } },
    { label: "empty option text", payload: { ...GOOD_RESPONSE, verification: { ...VERIFICATION_FIXTURE, options: { a: "1", b: "", c: "3", d: "4" } } } },
  ];

  for (const { label, payload } of bad) {
    resetAI(payload);
    let threw = false;
    let leaked = false;
    try {
      await executeErrorAwareness(executorInput(carelessRequest()));
      leaked = true;
    } catch (err) {
      threw = err instanceof Error;
    }
    assert(threw && !leaked, `4a: rejects ${label}`);
  }

  resetAI("nope");
  let message = "";
  try {
    await executeErrorAwareness(executorInput(carelessRequest()));
  } catch (err) {
    message = err instanceof Error ? err.message : "";
  }
  assert(
    message.includes("Error awareness AI response validation failed"),
    "4b: rejection names the stage",
  );

  resetAI();
  aiState.throwError = new Error("provider unavailable");
  let propagated = false;
  try {
    await executeErrorAwareness(executorInput(carelessRequest()));
  } catch (err) {
    propagated = err instanceof Error && err.message === "provider unavailable";
  }
  assert(propagated, "4c: provider errors propagate unchanged");

  resetAI({ ...GOOD_RESPONSE, checkingStep: 12 });
  const coerced = await executeErrorAwareness(executorInput(carelessRequest()));
  assert(coerced.breakdown.checkingStep === null, "4d: non-string optional degrades to null");

  console.log("  ✓ Bad AI output never becomes a repair");
}

// ─── 5. Routing through /api/repair ─────────────────────────

async function callRepair(body: unknown): Promise<{ status: number; json: Record<string, never> }> {
  const req = new NextRequest("http://localhost/api/repair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await repairRoute.POST(req);
  return { status: res.status, json: await res.json() };
}

async function section5() {
  section("5. Routing through the EXISTING /api/repair endpoint");

  routeState.user = { id: "user-1" };
  routeState.concept = {
    userId: "user-1",
    name: "features-of-constitution",
    displayName: "Features of Indian Constitution",
    subject: "Polity",
    keywords: ["Federal"],
  };

  resetAI();
  const res = await callRepair({
    conceptId: CONCEPT_ID,
    failureReason: "careless_mistake",
    questionContext: QUESTION_CTX,
  });

  assert(res.status === 200, "5a: route returns 200");
  const repair = res.json.data?.["repair"] as unknown as Record<string, unknown>;
  assert(repair !== null && repair !== undefined, "5b: a repair is returned, not null");
  assert(repair.failureReason === "careless_mistake", "5c: failureReason echoed unconverted");
  assert(repair.repairIntent === "error_awareness", "5d: routed to the R3.9 executor");
  assert(repair.breakdown !== undefined, "5e: breakdown returned to the client");
  assert(repair.verification !== undefined, "5f: verification returned to the client");
  assert(repair.explanation === undefined, "5g: no concept-teaching payload");
  assert(repair.retrieval === undefined, "5h: no active-recall payload");

  console.log("  ✓ /api/repair routes careless_mistake to R3.9");
}

// ─── 6. Existing verification + next-action flow ────────────

async function section6() {
  section("6. Compatibility with the EXISTING verification flow");

  resetAI();
  const req = carelessRequest();
  const repair = await executeErrorAwareness(executorInput(req));

  const validation = validateRepairVerification({
    requestId: repair.requestId,
    conceptId: repair.conceptId,
    failureReason: repair.failureReason,
    repairIntent: repair.repairIntent,
    verificationSelectedAnswer: "c",
    verificationCorrectAnswer: repair.verification.correctAnswer,
    verificationQuestion: repair.verification.question,
  });

  assert(validation.success, "6a: R3.3 accepts an error_awareness verification");
  if (!validation.success) throw new Error(validation.error);
  assert(validation.repairIntent === "error_awareness", "6b: R3.3 derives the intent server-side");

  const event = buildRepairVerificationEvent(validation.payload, validation.repairIntent);
  assert(event.eventType === "repair_verification", "6c: the SAME event type — no second mechanism");
  assert(event.eventMetadata.failureReason === "careless_mistake", "6d: failureReason stored unconverted");
  assert(event.eventMetadata.repairIntent === "error_awareness", "6e: repairIntent stored unconverted");
  assert(event.eventMetadata.verificationCorrect === true, "6f: outcome derived from the answer keys");
  assert(event.qualityRating === null && event.mcqCorrect === null, "6g: event inert w.r.t. SM-2");

  const tampered = validateRepairVerification({
    requestId: repair.requestId,
    conceptId: repair.conceptId,
    failureReason: "careless_mistake",
    repairIntent: "active_recall",
    verificationSelectedAnswer: "c",
    verificationCorrectAnswer: "c",
  });
  assert(!tampered.success, "6h: careless_mistake cannot claim active_recall");

  const derived = deriveRepairContext(event.eventMetadata);
  assert(derived.success, "6i: understanding derives context from this verification");
  if (!derived.success) throw new Error(derived.error);
  assert(derived.context.failureReason === "careless_mistake", "6j: derived failureReason unconverted");
  assert(
    decideNextAction({ verificationCorrect: true, postRepairUnderstanding: "understood" }) === "repair_complete",
    "6k: R3.4 unchanged on this path",
  );

  console.log("  ✓ Verification, understanding and next-action all unchanged");
}

// ─── 7. All six executors coexist ───────────────────────────

async function section7() {
  section("7. All six executors coexist and guard each other");

  const TEACHING = {
    coreIdea: "The Indian Constitution is quasi-federal: federal in structure, unitary in spirit.",
    whyItMatters: "This balance lets the Centre override States during emergencies.",
    example: "During a national emergency, the federal distribution of powers is suspended.",
    keyDistinction: "It is not purely federal like the US or purely unitary like the UK.",
    verification: VERIFICATION_FIXTURE,
  };
  const RECALL = {
    retrievalPrompt: "Name three features that make the Indian Constitution quasi-federal.",
    cue: "Think about the division of powers and the emergency provisions.",
    expectedAnswer: "Single citizenship, integrated judiciary, and the ability to convert to unitary during emergencies.",
    feedback: "If you recalled the judiciary point but missed single citizenship, that is the specific gap.",
    verification: VERIFICATION_FIXTURE,
  };
  const INTERPRETATION = {
    whatItAsked: "It asked which is NOT a feature, but you selected something that IS a feature.",
    decisiveWording: "The word NOT inverts what you are looking for.",
    whyYourAnswerMissed: "The selected option is a genuine feature, which is why it felt correct.",
    whatToLookFor: "Highlight negation words in the stem before scanning options.",
    verification: VERIFICATION_FIXTURE,
  };
  const UNCERTAINTY = {
    keyDistinction: "Single citizenship applies to India; dual citizenship applies to the US.",
    whyBetterSupported: "Article 5-11 establish a single citizenship framework.",
    competingOption: "Dual citizenship is tempting because of the federal structure.",
    howToDecide: "Ask: does the Constitution provide separate State citizenship?",
    verification: VERIFICATION_FIXTURE,
  };
  const CALIBRATION = {
    whatYouBelieved: "You likely believed India has dual citizenship because it is a federation.",
    whatWasActuallyCorrect: "India has single citizenship despite its federal structure.",
    whereConfidenceBroke: "The analogy to the US (federal + dual citizenship) feels natural but is wrong for India.",
    selfCheck: "Ask: 'Am I reasoning by analogy to another country, or from the Indian Constitution itself?'",
    verification: VERIFICATION_FIXTURE,
  };

  const cases: { label: string; reason: FailureReason; content: unknown; run: (i: never) => Promise<{ repairIntent: string; failureReason: string }> }[] = [
    { label: "concept_teaching", reason: "concept_not_understood", content: TEACHING, run: executeConceptTeaching as never },
    { label: "active_recall", reason: "could_not_recall", content: RECALL, run: executeActiveRecall as never },
    { label: "question_interpretation", reason: "misunderstood_question", content: INTERPRETATION, run: executeQuestionInterpretation as never },
    { label: "uncertainty_resolution", reason: "guessed", content: UNCERTAINTY, run: executeUncertaintyResolution as never },
    { label: "calibration", reason: "overconfident", content: CALIBRATION, run: executeCalibration as never },
    { label: "error_awareness", reason: "careless_mistake", content: GOOD_RESPONSE, run: executeErrorAwareness as never },
  ];

  for (const c of cases) {
    resetAI(c.content);
    const request = buildRepairRequest({
      failureReason: c.reason,
      conceptId: CONCEPT_ID,
      questionContext: QUESTION_CTX,
    });
    const repair = await c.run(executorInput(request) as never);
    assert(repair.repairIntent === c.label, `7a: ${c.label} executes and keeps its intent`);
    assert(repair.failureReason === c.reason, `7b: ${c.label} keeps failureReason ${c.reason}`);
  }

  for (const c of cases) {
    for (const other of cases) {
      if (other.reason === c.reason) continue;
      resetAI(c.content);
      const foreign = buildRepairRequest({ failureReason: other.reason, conceptId: CONCEPT_ID });
      let guarded = false;
      try {
        await c.run(executorInput(foreign) as never);
      } catch (err) {
        guarded = err instanceof Error && err.message.includes(c.label);
      }
      assert(guarded, `7c: ${c.label} rejects ${other.label}'s request`);
    }
  }

  console.log("  ✓ Six executors, each handling exactly its own intent");
}

// ─── 8. Isolation ───────────────────────────────────────────

section("8. Isolation — no SM-2, no legacy R2, no persistence");
{
  const source = readFileSync(
    join(process.cwd(), "src/lib/repair/error-awareness.executor.ts"),
    "utf-8",
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  const forbidden = [
    "lib/diagnostic", "spaced-repetition", "revision-intelligence",
    "revision.repository", "concept.repository", "@/lib/db", "supabase",
    "logEvent", "recordReview", "conceptMastery", "qualityRating",
    "concept_gap", "memory_gap", "calibration_gap", "revision_gap",
    "resolved", "score", "concept_not_understood", "could_not_recall",
  ];
  for (const token of forbidden) {
    assert(!code.includes(token), `8a: executor code never references "${token}"`);
  }
  assert(!code.includes("EVENT_TYPE"), "8b: declares no new event type");

  assert(source.includes("Do NOT diagnose the student"), "8c: no-diagnosis rule is in the system prompt");

  console.log("  ✓ Pure executor: AI + validation only, no diagnosis");
}

// ─── Summary ────────────────────────────────────────────────

async function main(): Promise<void> {
  await section2();
  await section3();
  await section4();
  await section5();
  await section6();
  await section7();

  section("RESULTS");
  console.log(`\n  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  if (failures.length > 0) {
    console.log(`\n  Failures:`);
    failures.forEach((f) => console.log(`    - ${f}`));
  }
  console.log(`\n  ${failed === 0 ? "✅ R3.9 ERROR AWARENESS: VALIDATED" : "❌ R3.9 ERROR AWARENESS: ISSUES FOUND"}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Unexpected test harness error:", err);
  process.exit(1);
});
