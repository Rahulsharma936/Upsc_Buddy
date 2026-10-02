/**
 * R3.7 — Uncertainty Resolution Executor Validation
 *
 * Deterministic tests for the repair that serves `guessed`.
 *
 * Tests:
 *   Section 1: Intent mapping and guard
 *   Section 2: Repair generation and structure (AI client stubbed)
 *   Section 3: Prompt targeting + the no-diagnosis rule
 *   Section 4: Malformed AI output and provider failure
 *   Section 5: Routing through the EXISTING /api/repair endpoint
 *   Section 6: Compatibility with the EXISTING verification + next-action flow
 *   Section 7: All four executors coexist and guard each other
 *   Section 8: Isolation — no SM-2, no legacy R2, no persistence, no diagnosis
 *
 * The AI CLIENT is stubbed; the real validation pipeline runs untouched.
 * No database, no network.
 *
 * Run: npx tsx src/lib/repair/__tests__/uncertainty-resolution.test.ts
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
  questionIndex: 3,
  selectedAnswer: "a",
  correctAnswer: "c",
  questionText: "Which body recommends the distribution of net proceeds of taxes between the Union and the States?",
  questionId: "q-fin-004",
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
    name: "finance-commission",
    displayName: "Finance Commission",
    subject: "Polity",
    keywords: ["Article 280", "Tax devolution"],
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
const { executeUncertaintyResolution } = require("@/lib/repair/uncertainty-resolution.executor") as typeof import("@/lib/repair/uncertainty-resolution.executor");
const { executeConceptTeaching } = require("@/lib/repair/concept-teaching.executor") as typeof import("@/lib/repair/concept-teaching.executor");
const { executeActiveRecall } = require("@/lib/repair/active-recall.executor") as typeof import("@/lib/repair/active-recall.executor");
const { executeQuestionInterpretation } = require("@/lib/repair/question-interpretation.executor") as typeof import("@/lib/repair/question-interpretation.executor");
const repairRoute = require("@/app/api/repair/route") as { POST: (req: unknown) => Promise<Response> };
const { NextRequest } = require("next/server") as { NextRequest: new (url: string, init: RequestInit) => unknown };
/* eslint-enable @typescript-eslint/no-require-imports */

const VERIFICATION_FIXTURE = {
  question: "Under Article 280, which recommendation is within the Finance Commission's remit?",
  options: {
    a: "Approving the Union Budget",
    b: "Distributing net tax proceeds between the Union and the States",
    c: "Appointing State Governors",
    d: "Auditing Union accounts",
  },
  correctAnswer: "b",
  explanation: "Article 280 charges the Finance Commission with recommending tax devolution.",
};

const GOOD_RESPONSE = {
  keyDistinction: "The Finance Commission recommends tax devolution; the CAG audits accounts. Recommendation versus audit is the dividing line.",
  whyBetterSupported: "Article 280 explicitly assigns the distribution of net tax proceeds to the Finance Commission.",
  competingOption: "The CAG was tempting because it also deals with Union finances, but its remit is auditing spent money, not recommending how it is shared.",
  howToDecide: "Ask whether the body ADVISES on future allocation or CHECKS past spending — that separates the Finance Commission from the CAG every time.",
  verification: VERIFICATION_FIXTURE,
};

function guessedRequest(ctx: RepairQuestionContext | null = QUESTION_CTX): RepairRequest {
  return buildRepairRequest({
    failureReason: "guessed",
    conceptId: CONCEPT_ID,
    questionContext: ctx ?? undefined,
  });
}

function executorInput(request: RepairRequest) {
  return {
    request,
    conceptName: "Finance Commission",
    conceptSubject: "Polity",
    conceptKeywords: ["Article 280", "Tax devolution"],
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
  const req = guessedRequest();
  assert(req.failureReason === "guessed", "1a: failureReason preserved verbatim");
  assert(req.repairIntent === "uncertainty_resolution", "1b: maps to uncertainty_resolution");
  assert(req.repairIntent !== "concept_teaching", "1c: NOT converted to a concept gap");
  assert(req.repairIntent !== "active_recall", "1d: NOT converted to a memory gap");
  assert(typeof req.requestId === "string" && req.requestId.length > 0, "1e: requestId minted");
  assert(
    VERIFIABLE_REPAIR_INTENTS.includes("uncertainty_resolution"),
    "1f: uncertainty_resolution is verifiable now it has an executor",
  );

  // The whole mapping table, unchanged.
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

  console.log("  ✓ guessed routes to uncertainty_resolution; no gap inferred");
}

// ─── 2. Repair generation and structure ─────────────────────

async function section2() {
  section("2. Repair generation and structure");

  resetAI();
  const req = guessedRequest();
  const repair = await executeUncertaintyResolution(executorInput(req));

  assert(repair.requestId === req.requestId, "2a: requestId preserved");
  assert(repair.conceptId === CONCEPT_ID, "2b: conceptId preserved");
  assert(repair.failureReason === "guessed", "2c: failureReason unconverted");
  assert(repair.repairIntent === "uncertainty_resolution", "2d: repairIntent unconverted");
  assert(repair.questionContext?.questionId === "q-fin-004", "2e: question context preserved");
  assert(repair.questionContext?.selectedAnswer === "a", "2f: the guessed option preserved");
  assert(repair.status === "ready", "2g: status ready");
  assert(repair.generatedAt instanceof Date, "2h: generatedAt is a Date");

  assert(repair.breakdown.keyDistinction === GOOD_RESPONSE.keyDistinction, "2i: keyDistinction returned");
  assert(repair.breakdown.whyBetterSupported === GOOD_RESPONSE.whyBetterSupported, "2j: whyBetterSupported returned");
  assert(repair.breakdown.competingOption === GOOD_RESPONSE.competingOption, "2k: competingOption returned");
  assert(repair.breakdown.howToDecide === GOOD_RESPONSE.howToDecide, "2l: howToDecide returned");

  // No other repair mode's payload.
  const asRecord = repair as unknown as Record<string, unknown>;
  assert(!("explanation" in asRecord), "2m: no concept-teaching explanation block");
  assert(!("retrieval" in asRecord), "2n: no active-recall retrieval block");

  // No diagnosis is recorded anywhere in the output.
  const serialized = JSON.stringify(repair);
  for (const token of ["concept_gap", "memory_gap", "calibration_gap", "diagnosis", "resolved"]) {
    assert(!serialized.includes(token), `2o: output carries no "${token}"`);
  }

  // Verification contract.
  assert(Object.keys(repair.verification.options).length === 4, "2p: four verification options");
  assert(repair.verification.correctAnswer === "b", "2q: verification answer key returned");
  assert(
    repair.verification.question !== QUESTION_CTX.questionText,
    "2r: verification differs from the original question",
  );

  // competingOption is optional when no rival is identifiable.
  resetAI({ ...GOOD_RESPONSE, competingOption: null });
  const noRival = await executeUncertaintyResolution(executorInput(guessedRequest(null)));
  assert(noRival.breakdown.competingOption === null, "2s: competingOption may be null");
  assert(noRival.questionContext === null, "2t: null question context preserved");

  // Intent guard fires before any AI call.
  resetAI();
  let guarded = false;
  try {
    await executeUncertaintyResolution(
      executorInput(buildRepairRequest({ failureReason: "could_not_recall", conceptId: CONCEPT_ID })),
    );
  } catch (err) {
    guarded = err instanceof Error && err.message.includes("uncertainty_resolution");
  }
  assert(guarded, "2u: executor rejects a foreign intent");
  assert(aiState.calls.length === 0, "2v: the guard fires before any AI call");

  console.log("  ✓ Distinction breakdown generated; no gap invented");
}

// ─── 3. Prompt targeting + no-diagnosis rule ────────────────

async function section3() {
  section("3. Prompt targeting and the no-diagnosis rule");

  resetAI();
  await executeUncertaintyResolution(executorInput(guessedRequest()));

  assert(aiState.calls.length === 1, "3a: exactly one AI call");
  const { prompt, systemPrompt } = aiState.calls[0];

  assert(prompt.includes("Finance Commission"), "3b: concept name in the prompt");
  assert(prompt.includes("Article 280"), "3c: keywords in the prompt");
  assert(prompt.includes(QUESTION_CTX.questionText!), "3d: failed question text in the prompt");
  assert(prompt.includes("Student guessed: a"), "3e: the guessed option in the prompt");
  assert(prompt.includes("Correct answer: c"), "3f: correct answer in the prompt");
  assert(prompt.includes("I wasn't sure and guessed"), "3g: the student's own words are quoted");

  // The prompt must forbid diagnosing the student.
  assert(systemPrompt.includes("Do NOT diagnose the student"), "3h: system prompt forbids diagnosis");
  assert(systemPrompt.includes("You do not know why they guessed"), "3i: uncertainty about cause is explicit");
  assert(systemPrompt.includes("DISTINGUISHES"), "3j: system prompt targets the distinction");
  assert(aiState.calls[0].format === "json", "3k: JSON format requested");

  // Without context it must not invent a competing option.
  resetAI();
  await executeUncertaintyResolution(executorInput(guessedRequest(null)));
  assert(
    aiState.calls[0].prompt.includes("Do NOT invent a competing option"),
    "3l: missing context forbids inventing a rival",
  );
  assert(!aiState.calls[0].prompt.includes("Student guessed:"), "3m: no guess invented");

  console.log("  ✓ Prompt resolves the distinction without diagnosing");
}

// ─── 4. Malformed AI output and provider failure ────────────

async function section4() {
  section("4. Malformed AI output and provider failure");

  const bad: { label: string; payload: unknown }[] = [
    { label: "not JSON at all", payload: "Sorry, I can't." },
    { label: "empty string", payload: "" },
    { label: "missing keyDistinction", payload: { ...GOOD_RESPONSE, keyDistinction: undefined } },
    { label: "missing whyBetterSupported", payload: { ...GOOD_RESPONSE, whyBetterSupported: undefined } },
    { label: "missing howToDecide", payload: { ...GOOD_RESPONSE, howToDecide: undefined } },
    { label: "missing verification", payload: { ...GOOD_RESPONSE, verification: undefined } },
    { label: "keyDistinction too short", payload: { ...GOOD_RESPONSE, keyDistinction: "eh" } },
    { label: "howToDecide too long", payload: { ...GOOD_RESPONSE, howToDecide: "x".repeat(801) } },
    { label: "invalid answer key", payload: { ...GOOD_RESPONSE, verification: { ...VERIFICATION_FIXTURE, correctAnswer: "e" } } },
    { label: "empty option text", payload: { ...GOOD_RESPONSE, verification: { ...VERIFICATION_FIXTURE, options: { a: "1", b: "", c: "3", d: "4" } } } },
  ];

  for (const { label, payload } of bad) {
    resetAI(payload);
    let threw = false;
    let leaked = false;
    try {
      await executeUncertaintyResolution(executorInput(guessedRequest()));
      leaked = true;
    } catch (err) {
      threw = err instanceof Error;
    }
    assert(threw && !leaked, `4a: rejects ${label}`);
  }

  resetAI("nope");
  let message = "";
  try {
    await executeUncertaintyResolution(executorInput(guessedRequest()));
  } catch (err) {
    message = err instanceof Error ? err.message : "";
  }
  assert(
    message.includes("Uncertainty resolution AI response validation failed"),
    "4b: rejection names the stage",
  );

  resetAI();
  aiState.throwError = new Error("provider unavailable");
  let propagated = false;
  try {
    await executeUncertaintyResolution(executorInput(guessedRequest()));
  } catch (err) {
    propagated = err instanceof Error && err.message === "provider unavailable";
  }
  assert(propagated, "4c: provider errors propagate unchanged");

  resetAI({ ...GOOD_RESPONSE, competingOption: 12 });
  const coerced = await executeUncertaintyResolution(executorInput(guessedRequest()));
  assert(coerced.breakdown.competingOption === null, "4d: non-string optional degrades to null");

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
    name: "finance-commission",
    displayName: "Finance Commission",
    subject: "Polity",
    keywords: ["Article 280"],
  };

  resetAI();
  const res = await callRepair({
    conceptId: CONCEPT_ID,
    failureReason: "guessed",
    questionContext: QUESTION_CTX,
  });

  assert(res.status === 200, "5a: route returns 200");
  const repair = res.json.data?.["repair"] as unknown as Record<string, unknown>;
  assert(repair !== null && repair !== undefined, "5b: a repair is returned, not null");
  assert(repair.failureReason === "guessed", "5c: failureReason echoed unconverted");
  assert(repair.repairIntent === "uncertainty_resolution", "5d: routed to the R3.7 executor");
  assert(repair.breakdown !== undefined, "5e: breakdown returned to the client");
  assert(repair.verification !== undefined, "5f: verification returned to the client");
  assert(repair.explanation === undefined, "5g: no concept-teaching payload");
  assert(repair.retrieval === undefined, "5h: no active-recall payload");

  console.log("  ✓ /api/repair routes guessed to R3.7");
}

// ─── 6. Existing verification + next-action flow ────────────

async function section6() {
  section("6. Compatibility with the EXISTING verification flow");

  resetAI();
  const req = guessedRequest();
  const repair = await executeUncertaintyResolution(executorInput(req));

  const validation = validateRepairVerification({
    requestId: repair.requestId,
    conceptId: repair.conceptId,
    failureReason: repair.failureReason,
    repairIntent: repair.repairIntent,
    verificationSelectedAnswer: "b",
    verificationCorrectAnswer: repair.verification.correctAnswer,
    verificationQuestion: repair.verification.question,
  });

  assert(validation.success, "6a: R3.3 accepts an uncertainty_resolution verification");
  if (!validation.success) throw new Error(validation.error);
  assert(validation.repairIntent === "uncertainty_resolution", "6b: R3.3 derives the intent server-side");

  const event = buildRepairVerificationEvent(validation.payload, validation.repairIntent);
  assert(event.eventType === "repair_verification", "6c: the SAME event type — no second mechanism");
  assert(event.eventMetadata.failureReason === "guessed", "6d: failureReason stored unconverted");
  assert(event.eventMetadata.repairIntent === "uncertainty_resolution", "6e: repairIntent stored unconverted");
  assert(event.eventMetadata.verificationCorrect === true, "6f: outcome derived from the answer keys");
  assert(event.qualityRating === null && event.mcqCorrect === null, "6g: event inert w.r.t. SM-2");

  const tampered = validateRepairVerification({
    requestId: repair.requestId,
    conceptId: repair.conceptId,
    failureReason: "guessed",
    repairIntent: "active_recall",
    verificationSelectedAnswer: "b",
    verificationCorrectAnswer: "b",
  });
  assert(!tampered.success, "6h: guessed cannot claim active_recall");

  const derived = deriveRepairContext(event.eventMetadata);
  assert(derived.success, "6i: understanding derives context from this verification");
  if (!derived.success) throw new Error(derived.error);
  assert(derived.context.failureReason === "guessed", "6j: derived failureReason unconverted");
  assert(
    decideNextAction({ verificationCorrect: false, postRepairUnderstanding: "still_not_understood" }) === "offer_another_repair",
    "6k: R3.4 unchanged on this path",
  );

  console.log("  ✓ Verification, understanding and next-action all unchanged");
}

// ─── 7. All four executors coexist ──────────────────────────

async function section7() {
  section("7. All four executors coexist and guard each other");

  const TEACHING = {
    coreIdea: "The Finance Commission is a constitutional body under Article 280.",
    whyItMatters: "It determines how tax revenue is shared between the Union and the States.",
    example: "The 15th Finance Commission recommended a 41% devolution share.",
    keyDistinction: "It recommends; it does not audit.",
    verification: VERIFICATION_FIXTURE,
  };
  const RECALL = {
    retrievalPrompt: "Which Article establishes the Finance Commission, and what does it recommend?",
    cue: "It sits in Part XII, among the finance provisions.",
    expectedAnswer: "Article 280 establishes it; it recommends the distribution of net tax proceeds.",
    feedback: "If you recalled Part XII but not the number, the gap is the article number alone.",
    verification: VERIFICATION_FIXTURE,
  };
  const INTERPRETATION = {
    whatItAsked: "It asked which body RECOMMENDS devolution, not which body audits it.",
    decisiveWording: "The verb 'recommends' is what separates the Finance Commission from the CAG.",
    whyYourAnswerMissed: "The chosen option performs audits, which is a different function.",
    whatToLookFor: "Match the task verb in the stem to the body's constitutional function.",
    verification: VERIFICATION_FIXTURE,
  };

  const cases: { label: string; reason: FailureReason; content: unknown; run: (i: never) => Promise<{ repairIntent: string; failureReason: string }> }[] = [
    { label: "concept_teaching", reason: "concept_not_understood", content: TEACHING, run: executeConceptTeaching as never },
    { label: "active_recall", reason: "could_not_recall", content: RECALL, run: executeActiveRecall as never },
    { label: "question_interpretation", reason: "misunderstood_question", content: INTERPRETATION, run: executeQuestionInterpretation as never },
    { label: "uncertainty_resolution", reason: "guessed", content: GOOD_RESPONSE, run: executeUncertaintyResolution as never },
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

  // Each executor refuses every other intent.
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

  console.log("  ✓ Four executors, each handling exactly its own intent");
}

// ─── 8. Isolation ───────────────────────────────────────────

section("8. Isolation — no SM-2, no legacy R2, no persistence");
{
  const source = readFileSync(
    join(process.cwd(), "src/lib/repair/uncertainty-resolution.executor.ts"),
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

  // The no-diagnosis instruction is in the shipped prompt, not just the docs.
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
  console.log(`\n  ${failed === 0 ? "✅ R3.7 UNCERTAINTY RESOLUTION: VALIDATED" : "❌ R3.7 UNCERTAINTY RESOLUTION: ISSUES FOUND"}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Unexpected test harness error:", err);
  process.exit(1);
});
