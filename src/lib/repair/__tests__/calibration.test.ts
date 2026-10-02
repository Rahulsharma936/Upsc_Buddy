/**
 * R3.8 — Calibration Executor Validation
 *
 * Deterministic tests for the repair that serves `overconfident`.
 *
 * Tests:
 *   Section 1: Intent mapping and guard
 *   Section 2: Repair generation and structure (AI client stubbed)
 *   Section 3: Prompt targeting + the no-diagnosis rule
 *   Section 4: Malformed AI output and provider failure
 *   Section 5: Routing through the EXISTING /api/repair endpoint
 *   Section 6: Compatibility with the EXISTING verification + next-action flow
 *   Section 7: All five executors coexist and guard each other
 *   Section 8: Isolation — no SM-2, no legacy R2, no persistence, no diagnosis
 *
 * The AI CLIENT is stubbed; the real validation pipeline runs untouched.
 * No database, no network.
 *
 * Run: npx tsx src/lib/repair/__tests__/calibration.test.ts
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
  questionIndex: 2,
  selectedAnswer: "b",
  correctAnswer: "d",
  questionText: "Which constitutional amendment introduced the anti-defection law in India?",
  questionId: "q-polity-008",
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
    name: "anti-defection-law",
    displayName: "Anti-Defection Law",
    subject: "Polity",
    keywords: ["52nd Amendment", "Tenth Schedule"],
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
const { executeCalibration } = require("@/lib/repair/calibration.executor") as typeof import("@/lib/repair/calibration.executor");
const { executeConceptTeaching } = require("@/lib/repair/concept-teaching.executor") as typeof import("@/lib/repair/concept-teaching.executor");
const { executeActiveRecall } = require("@/lib/repair/active-recall.executor") as typeof import("@/lib/repair/active-recall.executor");
const { executeQuestionInterpretation } = require("@/lib/repair/question-interpretation.executor") as typeof import("@/lib/repair/question-interpretation.executor");
const { executeUncertaintyResolution } = require("@/lib/repair/uncertainty-resolution.executor") as typeof import("@/lib/repair/uncertainty-resolution.executor");
const repairRoute = require("@/app/api/repair/route") as { POST: (req: unknown) => Promise<Response> };
const { NextRequest } = require("next/server") as { NextRequest: new (url: string, init: RequestInit) => unknown };
/* eslint-enable @typescript-eslint/no-require-imports */

const VERIFICATION_FIXTURE = {
  question: "Which constitutional amendment is associated with the Tenth Schedule?",
  options: {
    a: "44th Amendment",
    b: "42nd Amendment",
    c: "52nd Amendment",
    d: "73rd Amendment",
  },
  correctAnswer: "c",
  explanation: "The 52nd Amendment Act of 1985 added the Tenth Schedule (anti-defection provisions).",
};

const GOOD_RESPONSE = {
  whatYouBelieved: "You likely associated the anti-defection law with a major omnibus amendment like the 42nd, which is commonly studied and covers sweeping constitutional changes.",
  whatWasActuallyCorrect: "The anti-defection law was introduced by the 52nd Amendment Act of 1985, which added the Tenth Schedule to the Constitution.",
  whereConfidenceBroke: "The 42nd Amendment (1976) is one of the most discussed amendments and covers many topics, which makes it a plausible-sounding answer. But it predates the anti-defection law by nearly a decade.",
  selfCheck: "Before committing, ask: 'Do I remember the specific year and Schedule number for this law, or am I guessing from a famous amendment?'",
  verification: VERIFICATION_FIXTURE,
};

function overconfidentRequest(ctx: RepairQuestionContext | null = QUESTION_CTX): RepairRequest {
  return buildRepairRequest({
    failureReason: "overconfident",
    conceptId: CONCEPT_ID,
    questionContext: ctx ?? undefined,
  });
}

function executorInput(request: RepairRequest) {
  return {
    request,
    conceptName: "Anti-Defection Law",
    conceptSubject: "Polity",
    conceptKeywords: ["52nd Amendment", "Tenth Schedule"],
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
  const req = overconfidentRequest();
  assert(req.failureReason === "overconfident", "1a: failureReason preserved verbatim");
  assert(req.repairIntent === "calibration", "1b: maps to calibration");
  assert(req.repairIntent !== "concept_teaching", "1c: NOT converted to a concept gap");
  assert(req.repairIntent !== "active_recall", "1d: NOT converted to a memory gap");
  assert(req.repairIntent !== "uncertainty_resolution", "1e: NOT converted to uncertainty");
  assert(typeof req.requestId === "string" && req.requestId.length > 0, "1f: requestId minted");
  assert(
    VERIFIABLE_REPAIR_INTENTS.includes("calibration"),
    "1g: calibration is verifiable now it has an executor",
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
      `1h: ${reason} → ${expected[reason]} unchanged`,
    );
  }

  console.log("  ✓ overconfident routes to calibration; no gap inferred");
}

// ─── 2. Repair generation and structure ─────────────────────

async function section2() {
  section("2. Repair generation and structure");

  resetAI();
  const req = overconfidentRequest();
  const repair = await executeCalibration(executorInput(req));

  assert(repair.requestId === req.requestId, "2a: requestId preserved");
  assert(repair.conceptId === CONCEPT_ID, "2b: conceptId preserved");
  assert(repair.failureReason === "overconfident", "2c: failureReason unconverted");
  assert(repair.repairIntent === "calibration", "2d: repairIntent unconverted");
  assert(repair.questionContext?.questionId === "q-polity-008", "2e: question context preserved");
  assert(repair.questionContext?.selectedAnswer === "b", "2f: the confident selection preserved");
  assert(repair.status === "ready", "2g: status ready");
  assert(repair.generatedAt instanceof Date, "2h: generatedAt is a Date");

  assert(repair.breakdown.whatYouBelieved === GOOD_RESPONSE.whatYouBelieved, "2i: whatYouBelieved returned");
  assert(repair.breakdown.whatWasActuallyCorrect === GOOD_RESPONSE.whatWasActuallyCorrect, "2j: whatWasActuallyCorrect returned");
  assert(repair.breakdown.whereConfidenceBroke === GOOD_RESPONSE.whereConfidenceBroke, "2k: whereConfidenceBroke returned");
  assert(repair.breakdown.selfCheck === GOOD_RESPONSE.selfCheck, "2l: selfCheck returned");

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
  assert(repair.verification.correctAnswer === "c", "2q: verification answer key returned");
  assert(
    repair.verification.question !== QUESTION_CTX.questionText,
    "2r: verification differs from the original question",
  );

  // whereConfidenceBroke is optional when no context exists.
  resetAI({ ...GOOD_RESPONSE, whereConfidenceBroke: null });
  const noContext = await executeCalibration(executorInput(overconfidentRequest(null)));
  assert(noContext.breakdown.whereConfidenceBroke === null, "2s: whereConfidenceBroke may be null");
  assert(noContext.questionContext === null, "2t: null question context preserved");

  // Intent guard fires before any AI call.
  resetAI();
  let guarded = false;
  try {
    await executeCalibration(
      executorInput(buildRepairRequest({ failureReason: "could_not_recall", conceptId: CONCEPT_ID })),
    );
  } catch (err) {
    guarded = err instanceof Error && err.message.includes("calibration");
  }
  assert(guarded, "2u: executor rejects a foreign intent");
  assert(aiState.calls.length === 0, "2v: the guard fires before any AI call");

  console.log("  ✓ Calibration breakdown generated; no gap invented");
}

// ─── 3. Prompt targeting + no-diagnosis rule ────────────────

async function section3() {
  section("3. Prompt targeting and the no-diagnosis rule");

  resetAI();
  await executeCalibration(executorInput(overconfidentRequest()));

  assert(aiState.calls.length === 1, "3a: exactly one AI call");
  const { prompt, systemPrompt } = aiState.calls[0];

  assert(prompt.includes("Anti-Defection Law"), "3b: concept name in the prompt");
  assert(prompt.includes("52nd Amendment"), "3c: keywords in the prompt");
  assert(prompt.includes(QUESTION_CTX.questionText!), "3d: failed question text in the prompt");
  assert(prompt.includes("Student confidently selected: b"), "3e: the confident selection in the prompt");
  assert(prompt.includes("Correct answer: d"), "3f: correct answer in the prompt");
  assert(prompt.includes("I was confident, but got it wrong"), "3g: the student's own words are quoted");

  // The prompt must forbid diagnosing the student.
  assert(systemPrompt.includes("Do NOT diagnose the student"), "3h: system prompt forbids diagnosis");
  assert(systemPrompt.includes("Do NOT reteach the concept"), "3i: system prompt forbids reteaching");
  assert(systemPrompt.includes("MISMATCH"), "3j: system prompt targets the mismatch");
  assert(aiState.calls[0].format === "json", "3k: JSON format requested");

  // Without context it must not invent a mismatch.
  resetAI();
  await executeCalibration(executorInput(overconfidentRequest(null)));
  assert(
    aiState.calls[0].prompt.includes("Do NOT invent a mismatch"),
    "3l: missing context forbids inventing a mismatch",
  );
  assert(!aiState.calls[0].prompt.includes("Student confidently selected:"), "3m: no selection invented");

  console.log("  ✓ Prompt targets the confidence mismatch without diagnosing");
}

// ─── 4. Malformed AI output and provider failure ────────────

async function section4() {
  section("4. Malformed AI output and provider failure");

  const bad: { label: string; payload: unknown }[] = [
    { label: "not JSON at all", payload: "Sorry, I can't." },
    { label: "empty string", payload: "" },
    { label: "missing whatYouBelieved", payload: { ...GOOD_RESPONSE, whatYouBelieved: undefined } },
    { label: "missing whatWasActuallyCorrect", payload: { ...GOOD_RESPONSE, whatWasActuallyCorrect: undefined } },
    { label: "missing selfCheck", payload: { ...GOOD_RESPONSE, selfCheck: undefined } },
    { label: "missing verification", payload: { ...GOOD_RESPONSE, verification: undefined } },
    { label: "whatYouBelieved too short", payload: { ...GOOD_RESPONSE, whatYouBelieved: "eh" } },
    { label: "selfCheck too long", payload: { ...GOOD_RESPONSE, selfCheck: "x".repeat(801) } },
    { label: "invalid answer key", payload: { ...GOOD_RESPONSE, verification: { ...VERIFICATION_FIXTURE, correctAnswer: "e" } } },
    { label: "empty option text", payload: { ...GOOD_RESPONSE, verification: { ...VERIFICATION_FIXTURE, options: { a: "1", b: "", c: "3", d: "4" } } } },
  ];

  for (const { label, payload } of bad) {
    resetAI(payload);
    let threw = false;
    let leaked = false;
    try {
      await executeCalibration(executorInput(overconfidentRequest()));
      leaked = true;
    } catch (err) {
      threw = err instanceof Error;
    }
    assert(threw && !leaked, `4a: rejects ${label}`);
  }

  resetAI("nope");
  let message = "";
  try {
    await executeCalibration(executorInput(overconfidentRequest()));
  } catch (err) {
    message = err instanceof Error ? err.message : "";
  }
  assert(
    message.includes("Calibration AI response validation failed"),
    "4b: rejection names the stage",
  );

  resetAI();
  aiState.throwError = new Error("provider unavailable");
  let propagated = false;
  try {
    await executeCalibration(executorInput(overconfidentRequest()));
  } catch (err) {
    propagated = err instanceof Error && err.message === "provider unavailable";
  }
  assert(propagated, "4c: provider errors propagate unchanged");

  resetAI({ ...GOOD_RESPONSE, whereConfidenceBroke: 12 });
  const coerced = await executeCalibration(executorInput(overconfidentRequest()));
  assert(coerced.breakdown.whereConfidenceBroke === null, "4d: non-string optional degrades to null");

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
    name: "anti-defection-law",
    displayName: "Anti-Defection Law",
    subject: "Polity",
    keywords: ["52nd Amendment"],
  };

  resetAI();
  const res = await callRepair({
    conceptId: CONCEPT_ID,
    failureReason: "overconfident",
    questionContext: QUESTION_CTX,
  });

  assert(res.status === 200, "5a: route returns 200");
  const repair = res.json.data?.["repair"] as unknown as Record<string, unknown>;
  assert(repair !== null && repair !== undefined, "5b: a repair is returned, not null");
  assert(repair.failureReason === "overconfident", "5c: failureReason echoed unconverted");
  assert(repair.repairIntent === "calibration", "5d: routed to the R3.8 executor");
  assert(repair.breakdown !== undefined, "5e: breakdown returned to the client");
  assert(repair.verification !== undefined, "5f: verification returned to the client");
  assert(repair.explanation === undefined, "5g: no concept-teaching payload");
  assert(repair.retrieval === undefined, "5h: no active-recall payload");

  console.log("  ✓ /api/repair routes overconfident to R3.8");
}

// ─── 6. Existing verification + next-action flow ────────────

async function section6() {
  section("6. Compatibility with the EXISTING verification flow");

  resetAI();
  const req = overconfidentRequest();
  const repair = await executeCalibration(executorInput(req));

  const validation = validateRepairVerification({
    requestId: repair.requestId,
    conceptId: repair.conceptId,
    failureReason: repair.failureReason,
    repairIntent: repair.repairIntent,
    verificationSelectedAnswer: "c",
    verificationCorrectAnswer: repair.verification.correctAnswer,
    verificationQuestion: repair.verification.question,
  });

  assert(validation.success, "6a: R3.3 accepts a calibration verification");
  if (!validation.success) throw new Error(validation.error);
  assert(validation.repairIntent === "calibration", "6b: R3.3 derives the intent server-side");

  const event = buildRepairVerificationEvent(validation.payload, validation.repairIntent);
  assert(event.eventType === "repair_verification", "6c: the SAME event type — no second mechanism");
  assert(event.eventMetadata.failureReason === "overconfident", "6d: failureReason stored unconverted");
  assert(event.eventMetadata.repairIntent === "calibration", "6e: repairIntent stored unconverted");
  assert(event.eventMetadata.verificationCorrect === true, "6f: outcome derived from the answer keys");
  assert(event.qualityRating === null && event.mcqCorrect === null, "6g: event inert w.r.t. SM-2");

  const tampered = validateRepairVerification({
    requestId: repair.requestId,
    conceptId: repair.conceptId,
    failureReason: "overconfident",
    repairIntent: "active_recall",
    verificationSelectedAnswer: "c",
    verificationCorrectAnswer: "c",
  });
  assert(!tampered.success, "6h: overconfident cannot claim active_recall");

  const derived = deriveRepairContext(event.eventMetadata);
  assert(derived.success, "6i: understanding derives context from this verification");
  if (!derived.success) throw new Error(derived.error);
  assert(derived.context.failureReason === "overconfident", "6j: derived failureReason unconverted");
  assert(
    decideNextAction({ verificationCorrect: false, postRepairUnderstanding: "still_not_understood" }) === "offer_another_repair",
    "6k: R3.4 unchanged on this path",
  );

  console.log("  ✓ Verification, understanding and next-action all unchanged");
}

// ─── 7. All five executors coexist ──────────────────────────

async function section7() {
  section("7. All five executors coexist and guard each other");

  const TEACHING = {
    coreIdea: "The Anti-Defection Law prevents elected legislators from switching parties.",
    whyItMatters: "It strengthens party discipline and prevents horse-trading.",
    example: "If an MP leaves their party or votes against the whip, they can be disqualified.",
    keyDistinction: "It targets defection, not dissent within the party.",
    verification: VERIFICATION_FIXTURE,
  };
  const RECALL = {
    retrievalPrompt: "Which Amendment and Schedule introduced the anti-defection law?",
    cue: "It was added in the 1980s.",
    expectedAnswer: "The 52nd Amendment Act of 1985 added the Tenth Schedule.",
    feedback: "If you recalled the decade but not the number, the gap is the specific amendment.",
    verification: VERIFICATION_FIXTURE,
  };
  const INTERPRETATION = {
    whatItAsked: "It asked which amendment INTRODUCED the anti-defection law, not which amendment modified it.",
    decisiveWording: "The word 'introduced' points to the original enactment, not later modifications.",
    whyYourAnswerMissed: "The selected option was a later amendment that modified anti-defection provisions.",
    whatToLookFor: "Match 'introduced' to the first enactment, not subsequent amendments.",
    verification: VERIFICATION_FIXTURE,
  };
  const UNCERTAINTY = {
    keyDistinction: "The 52nd Amendment added the Tenth Schedule; the 91st Amendment modified it later.",
    whyBetterSupported: "The 52nd Amendment Act of 1985 is the original anti-defection enactment.",
    competingOption: "The 91st Amendment is tempting because it also deals with defection but only restricted its scope.",
    howToDecide: "Ask whether the question targets the original introduction or a later modification.",
    verification: VERIFICATION_FIXTURE,
  };

  const cases: { label: string; reason: FailureReason; content: unknown; run: (i: never) => Promise<{ repairIntent: string; failureReason: string }> }[] = [
    { label: "concept_teaching", reason: "concept_not_understood", content: TEACHING, run: executeConceptTeaching as never },
    { label: "active_recall", reason: "could_not_recall", content: RECALL, run: executeActiveRecall as never },
    { label: "question_interpretation", reason: "misunderstood_question", content: INTERPRETATION, run: executeQuestionInterpretation as never },
    { label: "uncertainty_resolution", reason: "guessed", content: UNCERTAINTY, run: executeUncertaintyResolution as never },
    { label: "calibration", reason: "overconfident", content: GOOD_RESPONSE, run: executeCalibration as never },
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

  console.log("  ✓ Five executors, each handling exactly its own intent");
}

// ─── 8. Isolation ───────────────────────────────────────────

section("8. Isolation — no SM-2, no legacy R2, no persistence");
{
  const source = readFileSync(
    join(process.cwd(), "src/lib/repair/calibration.executor.ts"),
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
  console.log(`\n  ${failed === 0 ? "✅ R3.8 CALIBRATION: VALIDATED" : "❌ R3.8 CALIBRATION: ISSUES FOUND"}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Unexpected test harness error:", err);
  process.exit(1);
});
