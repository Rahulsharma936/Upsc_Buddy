/**
 * R3.6 — Question Interpretation Executor Validation
 *
 * Deterministic tests for the repair that serves misunderstood_question.
 *
 * Tests:
 *   Section 1: Intent mapping and guard
 *   Section 2: Repair generation and structure (AI client stubbed)
 *   Section 3: Prompt targeting — the actual failed question is used
 *   Section 4: Malformed AI output and provider failure
 *   Section 5: Routing through the EXISTING /api/repair endpoint
 *   Section 6: Compatibility with the EXISTING verification + next-action flow
 *   Section 7: Isolation — no SM-2, no legacy R2, no persistence, no diagnosis
 *
 * The AI CLIENT is stubbed; the real validation pipeline (JSON repair + the
 * real Zod schema) runs untouched. No database, no network.
 *
 * Run: npx tsx src/lib/repair/__tests__/question-interpretation.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRepairRequest } from "@/lib/repair/repair-request.builder";
import type { RepairRequest, RepairQuestionContext } from "@/lib/repair/repair-request.builder";
import {
  validateRepairVerification,
  buildRepairVerificationEvent,
  VERIFIABLE_REPAIR_INTENTS,
} from "@/lib/repair/repair-verification";
import { deriveRepairContext } from "@/lib/repair/repair-understanding";
import { decideNextAction } from "@/lib/repair/repair-next-action";

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
  questionIndex: 2,
  selectedAnswer: "b",
  correctAnswer: "d",
  questionText: "Which of the following is NOT a ground for restricting free speech under Article 19(2)?",
  questionId: "q-fr-019",
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
    name: "fundamental-rights",
    displayName: "Fundamental Rights",
    subject: "Polity",
    keywords: ["Article 19", "Reasonable restrictions"],
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
const { executeQuestionInterpretation } = require("@/lib/repair/question-interpretation.executor") as typeof import("@/lib/repair/question-interpretation.executor");
const repairRoute = require("@/app/api/repair/route") as { POST: (req: unknown) => Promise<Response> };
const { NextRequest } = require("next/server") as { NextRequest: new (url: string, init: RequestInit) => unknown };
/* eslint-enable @typescript-eslint/no-require-imports */

const GOOD_RESPONSE = {
  whatItAsked: "It asked which listed ground is NOT permitted under Article 19(2) — an exception question, not a list-recall question.",
  decisiveWording: "The capitalised 'NOT' inverts the task: three options are valid grounds and only one is not.",
  whyYourAnswerMissed: "Option b (public order) IS a listed ground, so it answers 'which is valid' — the opposite of what was asked.",
  whatToLookFor: "When a stem contains NOT or EXCEPT, find the three options that share a property and pick the odd one out.",
  verification: {
    question: "A question asks 'All of the following are Fundamental Duties EXCEPT'. What is the task?",
    options: {
      a: "Identify the item that is not a Fundamental Duty",
      b: "List all Fundamental Duties",
      c: "Rank the duties by importance",
      d: "Identify the most important duty",
    },
    correctAnswer: "a",
    explanation: "'EXCEPT' inverts the stem: the answer is the single item that does not belong to the set.",
  },
};

function interpretationRequest(ctx: RepairQuestionContext | null = QUESTION_CTX): RepairRequest {
  return buildRepairRequest({
    failureReason: "misunderstood_question",
    conceptId: CONCEPT_ID,
    questionContext: ctx ?? undefined,
  });
}

function executorInput(request: RepairRequest) {
  return {
    request,
    conceptName: "Fundamental Rights",
    conceptSubject: "Polity",
    conceptKeywords: ["Article 19", "Reasonable restrictions"],
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
  const req = interpretationRequest();
  assert(req.failureReason === "misunderstood_question", "1a: failureReason preserved verbatim");
  assert(req.repairIntent === "question_interpretation", "1b: maps to question_interpretation");
  assert(req.repairIntent !== "concept_teaching", "1c: NOT converted to concept teaching");
  assert(req.conceptId === CONCEPT_ID, "1d: conceptId carried");
  assert(typeof req.requestId === "string" && req.requestId.length > 0, "1e: requestId minted");
  assert(
    VERIFIABLE_REPAIR_INTENTS.includes("question_interpretation"),
    "1f: question_interpretation is verifiable now it has an executor",
  );

  console.log("  ✓ misunderstood_question routes to question_interpretation");
}

// ─── 2. Repair generation and structure ─────────────────────

async function section2() {
  section("2. Repair generation and structure");

  resetAI();
  const req = interpretationRequest();
  const repair = await executeQuestionInterpretation(executorInput(req));

  assert(repair.requestId === req.requestId, "2a: requestId preserved");
  assert(repair.conceptId === CONCEPT_ID, "2b: conceptId preserved");
  assert(repair.failureReason === "misunderstood_question", "2c: failureReason unconverted");
  assert(repair.repairIntent === "question_interpretation", "2d: repairIntent unconverted");
  assert(repair.questionContext?.questionId === "q-fr-019", "2e: question context preserved");
  assert(repair.questionContext?.selectedAnswer === "b", "2f: student's selection preserved");
  assert(repair.status === "ready", "2g: status ready");
  assert(repair.generatedAt instanceof Date, "2h: generatedAt is a Date");

  assert(repair.breakdown.whatItAsked === GOOD_RESPONSE.whatItAsked, "2i: whatItAsked returned");
  assert(repair.breakdown.decisiveWording === GOOD_RESPONSE.decisiveWording, "2j: decisiveWording returned");
  assert(repair.breakdown.whyYourAnswerMissed === GOOD_RESPONSE.whyYourAnswerMissed, "2k: whyYourAnswerMissed returned");
  assert(repair.breakdown.whatToLookFor === GOOD_RESPONSE.whatToLookFor, "2l: whatToLookFor returned");

  // Not a concept lesson — no teaching payload.
  const asRecord = repair as unknown as Record<string, unknown>;
  assert(!("explanation" in asRecord), "2m: no concept-teaching explanation block");
  assert(!("retrieval" in asRecord), "2n: no active-recall retrieval block");

  // Verification contract.
  assert(Object.keys(repair.verification.options).length === 4, "2o: four verification options");
  assert(repair.verification.correctAnswer === "a", "2p: verification answer key returned");
  assert(
    repair.verification.question !== QUESTION_CTX.questionText,
    "2q: verification differs from the original question",
  );

  // Optional field may be null when there is no misread to explain.
  resetAI({ ...GOOD_RESPONSE, whyYourAnswerMissed: null });
  const noMissed = await executeQuestionInterpretation(executorInput(interpretationRequest(null)));
  assert(noMissed.breakdown.whyYourAnswerMissed === null, "2r: whyYourAnswerMissed may be null");
  assert(noMissed.questionContext === null, "2s: null question context preserved");

  // Intent guard fires before any AI call.
  resetAI();
  let guarded = false;
  try {
    await executeQuestionInterpretation(
      executorInput(buildRepairRequest({ failureReason: "guessed", conceptId: CONCEPT_ID })),
    );
  } catch (err) {
    guarded = err instanceof Error && err.message.includes("question_interpretation");
  }
  assert(guarded, "2t: executor rejects a foreign intent");
  assert(aiState.calls.length === 0, "2u: the guard fires before any AI call");

  console.log("  ✓ Interpretation breakdown generated; context preserved");
}

// ─── 3. Prompt targeting ────────────────────────────────────

async function section3() {
  section("3. Prompt targeting — the actual failed question is used");

  resetAI();
  await executeQuestionInterpretation(executorInput(interpretationRequest()));

  assert(aiState.calls.length === 1, "3a: exactly one AI call");
  const { prompt, systemPrompt } = aiState.calls[0];

  assert(prompt.includes("Fundamental Rights"), "3b: concept name in the prompt");
  assert(prompt.includes("Polity"), "3c: subject in the prompt");
  assert(prompt.includes(QUESTION_CTX.questionText!), "3d: failed question text in the prompt");
  assert(prompt.includes("Student selected: b"), "3e: student's selection in the prompt");
  assert(prompt.includes("Correct answer: d"), "3f: correct answer in the prompt");
  assert(prompt.includes("I misunderstood the question/options"), "3g: the student's own words are quoted");

  assert(systemPrompt.includes("NOT a concept lesson"), "3h: system prompt forbids a concept lesson");
  assert(systemPrompt.includes("qualifiers"), "3i: system prompt targets question wording");
  assert(systemPrompt.includes("test INTERPRETATION"), "3j: verification must test interpretation");
  assert(aiState.calls[0].format === "json", "3k: JSON format requested");

  // Without context it must not invent a misreading.
  resetAI();
  await executeQuestionInterpretation(executorInput(interpretationRequest(null)));
  assert(
    aiState.calls[0].prompt.includes("Do NOT invent a misreading"),
    "3l: missing context forbids inventing a misread",
  );
  assert(!aiState.calls[0].prompt.includes("Student selected:"), "3m: no selection invented");

  console.log("  ✓ Prompt is anchored to the actual failed question");
}

// ─── 4. Malformed AI output and provider failure ────────────

async function section4() {
  section("4. Malformed AI output and provider failure");

  const bad: { label: string; payload: unknown }[] = [
    { label: "not JSON at all", payload: "Sorry, I can't." },
    { label: "empty string", payload: "" },
    { label: "missing whatItAsked", payload: { ...GOOD_RESPONSE, whatItAsked: undefined } },
    { label: "missing decisiveWording", payload: { ...GOOD_RESPONSE, decisiveWording: undefined } },
    { label: "missing whatToLookFor", payload: { ...GOOD_RESPONSE, whatToLookFor: undefined } },
    { label: "missing verification", payload: { ...GOOD_RESPONSE, verification: undefined } },
    { label: "whatItAsked too short", payload: { ...GOOD_RESPONSE, whatItAsked: "eh" } },
    { label: "whatItAsked too long", payload: { ...GOOD_RESPONSE, whatItAsked: "x".repeat(801) } },
    { label: "invalid answer key", payload: { ...GOOD_RESPONSE, verification: { ...GOOD_RESPONSE.verification, correctAnswer: "z" } } },
    { label: "only three options", payload: { ...GOOD_RESPONSE, verification: { ...GOOD_RESPONSE.verification, options: { a: "1", b: "2", c: "3" } } } },
  ];

  for (const { label, payload } of bad) {
    resetAI(payload);
    let threw = false;
    let leaked = false;
    try {
      await executeQuestionInterpretation(executorInput(interpretationRequest()));
      leaked = true;
    } catch (err) {
      threw = err instanceof Error;
    }
    assert(threw && !leaked, `4a: rejects ${label}`);
  }

  resetAI("nope");
  let message = "";
  try {
    await executeQuestionInterpretation(executorInput(interpretationRequest()));
  } catch (err) {
    message = err instanceof Error ? err.message : "";
  }
  assert(
    message.includes("Question interpretation AI response validation failed"),
    "4b: rejection names the stage",
  );

  resetAI();
  aiState.throwError = new Error("provider unavailable");
  let propagated = false;
  try {
    await executeQuestionInterpretation(executorInput(interpretationRequest()));
  } catch (err) {
    propagated = err instanceof Error && err.message === "provider unavailable";
  }
  assert(propagated, "4c: provider errors propagate unchanged");

  resetAI({ ...GOOD_RESPONSE, whyYourAnswerMissed: 7 });
  const coerced = await executeQuestionInterpretation(executorInput(interpretationRequest()));
  assert(coerced.breakdown.whyYourAnswerMissed === null, "4d: non-string optional degrades to null");

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
    name: "fundamental-rights",
    displayName: "Fundamental Rights",
    subject: "Polity",
    keywords: ["Article 19"],
  };

  resetAI();
  const res = await callRepair({
    conceptId: CONCEPT_ID,
    failureReason: "misunderstood_question",
    questionContext: QUESTION_CTX,
  });

  assert(res.status === 200, "5a: route returns 200");
  assert(res.json.success === true, "5b: route reports success");
  const repair = res.json.data?.["repair"] as unknown as Record<string, unknown>;
  assert(repair !== null && repair !== undefined, "5c: a repair is returned, not null");
  assert(repair.failureReason === "misunderstood_question", "5d: failureReason echoed unconverted");
  assert(repair.repairIntent === "question_interpretation", "5e: routed to the R3.6 executor");
  assert(repair.breakdown !== undefined, "5f: breakdown returned to the client");
  assert(repair.verification !== undefined, "5g: verification returned to the client");
  assert(repair.explanation === undefined, "5h: no concept-teaching payload in the response");
  assert(repair.retrieval === undefined, "5i: no active-recall payload in the response");
  assert(typeof repair.requestId === "string", "5j: requestId returned for correlation");

  // Auth and ownership are enforced by the existing route, unchanged.
  routeState.user = null;
  const unauth = await callRepair({ conceptId: CONCEPT_ID, failureReason: "misunderstood_question" });
  assert(unauth.status === 401, "5k: unauthenticated request rejected");

  routeState.user = { id: "user-1" };
  routeState.concept = { userId: "someone-else", name: "x", displayName: "X", subject: "Polity", keywords: [] };
  resetAI();
  const foreign = await callRepair({ conceptId: CONCEPT_ID, failureReason: "misunderstood_question" });
  assert(foreign.status === 404, "5l: foreign concept rejected with 404");

  routeState.concept = undefined;
  resetAI();
  const missing = await callRepair({ conceptId: CONCEPT_ID, failureReason: "misunderstood_question" });
  assert(missing.status === 404, "5m: missing concept rejected with 404");

  // An intent with no executor still reports itself as unimplemented.
  routeState.concept = { userId: "user-1", name: "x", displayName: "X", subject: "Polity", keywords: [] };
  resetAI();
  const notImpl = await callRepair({ conceptId: CONCEPT_ID, failureReason: "careless_mistake" });
  assert(notImpl.status === 200, "5n: unimplemented intent still returns 200");
  assert(notImpl.json.data?.["repair"] === null, "5o: unimplemented intent returns a null repair");

  console.log("  ✓ /api/repair routes misunderstood_question to R3.6");
}

// ─── 6. Existing verification + next-action flow ────────────

async function section6() {
  section("6. Compatibility with the EXISTING verification flow");

  resetAI();
  const req = interpretationRequest();
  const repair = await executeQuestionInterpretation(executorInput(req));

  const validation = validateRepairVerification({
    requestId: repair.requestId,
    conceptId: repair.conceptId,
    failureReason: repair.failureReason,
    repairIntent: repair.repairIntent,
    verificationSelectedAnswer: "a",
    verificationCorrectAnswer: repair.verification.correctAnswer,
    verificationQuestion: repair.verification.question,
  });

  assert(validation.success, "6a: R3.3 accepts a question_interpretation verification");
  if (!validation.success) throw new Error(validation.error);
  assert(validation.repairIntent === "question_interpretation", "6b: R3.3 derives the intent server-side");

  const event = buildRepairVerificationEvent(validation.payload, validation.repairIntent);
  assert(event.eventType === "repair_verification", "6c: the SAME event type — no second mechanism");
  assert(event.eventMetadata.failureReason === "misunderstood_question", "6d: failureReason stored unconverted");
  assert(event.eventMetadata.repairIntent === "question_interpretation", "6e: repairIntent stored unconverted");
  assert(event.qualityRating === null && event.mcqCorrect === null, "6f: event inert w.r.t. SM-2");

  // A client cannot turn this repair into another intent.
  const tampered = validateRepairVerification({
    requestId: repair.requestId,
    conceptId: repair.conceptId,
    failureReason: "misunderstood_question",
    repairIntent: "concept_teaching",
    verificationSelectedAnswer: "a",
    verificationCorrectAnswer: "a",
  });
  assert(!tampered.success, "6g: misunderstood_question cannot claim concept_teaching");

  // Understanding + next action work unchanged.
  const derived = deriveRepairContext(event.eventMetadata);
  assert(derived.success, "6h: understanding derives context from this verification");
  if (!derived.success) throw new Error(derived.error);
  assert(derived.context.repairIntent === "question_interpretation", "6i: derived intent unconverted");
  assert(
    decideNextAction({ verificationCorrect: true, postRepairUnderstanding: "understood" }) === "repair_complete",
    "6j: R3.4 unchanged on this path",
  );

  console.log("  ✓ Verification, understanding and next-action all unchanged");
}

// ─── 7. Isolation ───────────────────────────────────────────

section("7. Isolation — no SM-2, no legacy R2, no persistence");
{
  const source = readFileSync(
    join(process.cwd(), "src/lib/repair/question-interpretation.executor.ts"),
    "utf-8",
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  const forbidden = [
    "lib/diagnostic", "spaced-repetition", "revision-intelligence",
    "revision.repository", "concept.repository", "@/lib/db", "supabase",
    "logEvent", "recordReview", "conceptMastery", "qualityRating",
    "concept_gap", "memory_gap", "calibration_gap", "revision_gap",
    "diagnosis", "resolved", "score", "concept_not_understood",
  ];
  for (const token of forbidden) {
    assert(!code.includes(token), `7a: executor code never references "${token}"`);
  }
  assert(!code.includes("EVENT_TYPE"), "7b: declares no new event type");

  console.log("  ✓ Pure executor: AI + validation only");
}

// ─── Summary ────────────────────────────────────────────────

async function main(): Promise<void> {
  await section2();
  await section3();
  await section4();
  await section5();
  await section6();

  section("RESULTS");
  console.log(`\n  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  if (failures.length > 0) {
    console.log(`\n  Failures:`);
    failures.forEach((f) => console.log(`    - ${f}`));
  }
  console.log(`\n  ${failed === 0 ? "✅ R3.6 QUESTION INTERPRETATION: VALIDATED" : "❌ R3.6 QUESTION INTERPRETATION: ISSUES FOUND"}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Unexpected test harness error:", err);
  process.exit(1);
});
