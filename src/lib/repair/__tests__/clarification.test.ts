/**
 * R3.10 — Clarification Executor Validation
 *
 * Deterministic tests for the repair that serves `not_sure`.
 *
 * Tests:
 *   Section 1: Intent mapping and guard
 *   Section 2: Repair generation and structure (AI client stubbed)
 *   Section 3: Prompt targeting + the no-diagnosis rule
 *   Section 4: Malformed AI output and provider failure
 *   Section 5: Routing through the EXISTING /api/repair endpoint
 *   Section 6: Verification is correctly absent — clarification has no MCQ
 *   Section 7: All seven executors coexist and guard each other
 *   Section 8: Isolation — no SM-2, no legacy R2, no persistence, no diagnosis
 *
 * The AI CLIENT is stubbed; the real validation pipeline runs untouched.
 * No database, no network.
 *
 * Run: npx tsx src/lib/repair/__tests__/clarification.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRepairRequest, ALL_FAILURE_REASONS } from "@/lib/repair/repair-request.builder";
import type { RepairRequest, RepairQuestionContext } from "@/lib/repair/repair-request.builder";
import {
  validateRepairVerification,
  VERIFIABLE_REPAIR_INTENTS,
} from "@/lib/repair/repair-verification";
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
  selectedAnswer: "b",
  correctAnswer: "d",
  questionText: "Which committee recommended the creation of Panchayati Raj institutions?",
  questionId: "q-polity-055",
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

const VERIFICATION_FIXTURE = {
  question: "Which of the following statements about Panchayati Raj is INCORRECT?",
  options: {
    a: "The 73rd Amendment constitutionalised Panchayati Raj",
    b: "Balwant Rai Mehta Committee recommended a three-tier system",
    c: "Panchayats are directly elected by the people",
    d: "Panchayati Raj is a Fundamental Right",
  },
  correctAnswer: "d",
  explanation: "Panchayati Raj is a Directive Principle (Article 40), not a Fundamental Right.",
};

const routeState = {
  user: { id: "user-1" } as { id: string } | null,
  concept: {
    userId: "user-1",
    name: "panchayati-raj",
    displayName: "Panchayati Raj Institutions",
    subject: "Polity",
    keywords: ["73rd Amendment", "Balwant Rai Mehta", "Local Self-Government"],
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
const { executeClarification } = require("@/lib/repair/clarification.executor") as typeof import("@/lib/repair/clarification.executor");
const { executeErrorAwareness } = require("@/lib/repair/error-awareness.executor") as typeof import("@/lib/repair/error-awareness.executor");
const { executeConceptTeaching } = require("@/lib/repair/concept-teaching.executor") as typeof import("@/lib/repair/concept-teaching.executor");
const { executeActiveRecall } = require("@/lib/repair/active-recall.executor") as typeof import("@/lib/repair/active-recall.executor");
const { executeQuestionInterpretation } = require("@/lib/repair/question-interpretation.executor") as typeof import("@/lib/repair/question-interpretation.executor");
const { executeUncertaintyResolution } = require("@/lib/repair/uncertainty-resolution.executor") as typeof import("@/lib/repair/uncertainty-resolution.executor");
const { executeCalibration } = require("@/lib/repair/calibration.executor") as typeof import("@/lib/repair/calibration.executor");
const repairRoute = require("@/app/api/repair/route") as { POST: (req: unknown) => Promise<Response> };
const { NextRequest } = require("next/server") as { NextRequest: new (url: string, init: RequestInit) => unknown };
/* eslint-enable @typescript-eslint/no-require-imports */

const GOOD_RESPONSE = {
  whatTheQuestionNeeded: "This question required knowing which committee recommended the creation of Panchayati Raj institutions — specifically the Balwant Rai Mehta Committee (1957), which recommended a three-tier system of local self-government.",
  possibleStumblingPoints: [
    "Multiple committees are associated with Panchayati Raj (Balwant Rai Mehta, Ashok Mehta, L.M. Singhvi), and confusing which one recommended creation versus reform is a common mix-up.",
    "The question asks about 'creation' specifically — some students may recall the 73rd Amendment (1992) which constitutionalised Panchayati Raj, but the recommendation for creation came much earlier.",
  ],
  howToNarrowItDown: "Ask yourself: (1) Can I name the committee and the year? If not, it may be a recall issue. (2) Did I confuse 'creation' with 'constitutionalisation'? If so, it may be a distinction issue. (3) Did I read 'creation' carefully or skim past it? If so, it may be a reading issue.",
  nextTimeStrategy: "When a question mentions a specific action (created, recommended, constitutionalised), pin down the exact verb before scanning options — different committees and amendments correspond to different actions.",
};

function notSureRequest(ctx: RepairQuestionContext | null = QUESTION_CTX): RepairRequest {
  return buildRepairRequest({
    failureReason: "not_sure",
    conceptId: CONCEPT_ID,
    questionContext: ctx ?? undefined,
  });
}

function executorInput(request: RepairRequest) {
  return {
    request,
    conceptName: "Panchayati Raj Institutions",
    conceptSubject: "Polity",
    conceptKeywords: ["73rd Amendment", "Balwant Rai Mehta", "Local Self-Government"],
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
  const req = notSureRequest();
  assert(req.failureReason === "not_sure", "1a: failureReason preserved verbatim");
  assert(req.repairIntent === "clarification", "1b: maps to clarification");
  assert(req.repairIntent !== "concept_teaching", "1c: NOT converted to concept teaching");
  assert(req.repairIntent !== "error_awareness", "1d: NOT converted to error awareness");
  assert(typeof req.requestId === "string" && req.requestId.length > 0, "1e: requestId minted");
  assert(req.verificationRequired === false, "1f: verification NOT required for clarification");
  assert(req.status === "pending", "1g: status starts as pending");

  // clarification should NOT be in VERIFIABLE_REPAIR_INTENTS
  assert(
    !VERIFIABLE_REPAIR_INTENTS.includes("clarification"),
    "1h: clarification is NOT verifiable (no MCQ to verify)",
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
      `1i: ${reason} → ${expected[reason]} unchanged`,
    );
  }

  console.log("  ✓ not_sure routes to clarification; no gap inferred; no verification required");
}

// ─── 2. Repair generation and structure ─────────────────────

async function section2() {
  section("2. Repair generation and structure");

  resetAI();
  const req = notSureRequest();
  const repair = await executeClarification(executorInput(req));

  assert(repair.requestId === req.requestId, "2a: requestId preserved");
  assert(repair.conceptId === CONCEPT_ID, "2b: conceptId preserved");
  assert(repair.failureReason === "not_sure", "2c: failureReason unconverted");
  assert(repair.repairIntent === "clarification", "2d: repairIntent unconverted");
  assert(repair.questionContext?.questionId === "q-polity-055", "2e: question context preserved");
  assert(repair.questionContext?.selectedAnswer === "b", "2f: the student's selection preserved");
  assert(repair.status === "ready", "2g: status ready");
  assert(repair.generatedAt instanceof Date, "2h: generatedAt is a Date");

  // Breakdown structure
  assert(repair.breakdown.whatTheQuestionNeeded === GOOD_RESPONSE.whatTheQuestionNeeded, "2i: whatTheQuestionNeeded returned");
  assert(Array.isArray(repair.breakdown.possibleStumblingPoints), "2j: possibleStumblingPoints is array");
  assert(repair.breakdown.possibleStumblingPoints.length >= 2, "2k: at least 2 stumbling points");
  assert(repair.breakdown.possibleStumblingPoints.length <= 3, "2l: at most 3 stumbling points");
  assert(repair.breakdown.howToNarrowItDown === GOOD_RESPONSE.howToNarrowItDown, "2m: howToNarrowItDown returned");
  assert(repair.breakdown.nextTimeStrategy === GOOD_RESPONSE.nextTimeStrategy, "2n: nextTimeStrategy returned");

  // No verification — this is the key difference
  assert(repair.verification === null, "2o: verification is null (clarification has no MCQ)");

  // No other executor's payload shapes
  const asRecord = repair as unknown as Record<string, unknown>;
  assert(!("explanation" in asRecord), "2p: no concept-teaching explanation block");
  assert(!("retrieval" in asRecord), "2q: no active-recall retrieval block");

  const serialized = JSON.stringify(repair);
  for (const token of ["concept_gap", "memory_gap", "calibration_gap", "diagnosis", "resolved"]) {
    assert(!serialized.includes(token), `2r: output carries no "${token}"`);
  }

  // Without question context
  resetAI({ ...GOOD_RESPONSE, howToNarrowItDown: null });
  const noContext = await executeClarification(executorInput(notSureRequest(null)));
  assert(noContext.breakdown.howToNarrowItDown === null, "2s: howToNarrowItDown may be null");
  assert(noContext.questionContext === null, "2t: null question context preserved");
  assert(noContext.verification === null, "2u: still no verification without context");

  // Intent guard
  resetAI();
  let guarded = false;
  try {
    await executeClarification(
      executorInput(buildRepairRequest({ failureReason: "could_not_recall", conceptId: CONCEPT_ID })),
    );
  } catch (err) {
    guarded = err instanceof Error && err.message.includes("clarification");
  }
  assert(guarded, "2v: executor rejects a foreign intent");
  assert(aiState.calls.length === 0, "2w: the guard fires before any AI call");

  console.log("  ✓ Clarification breakdown generated; no verification; no gap invented");
}

// ─── 3. Prompt targeting + no-diagnosis rule ────────────────

async function section3() {
  section("3. Prompt targeting and the no-diagnosis rule");

  resetAI();
  await executeClarification(executorInput(notSureRequest()));

  assert(aiState.calls.length === 1, "3a: exactly one AI call");
  const { prompt, systemPrompt } = aiState.calls[0];

  assert(prompt.includes("Panchayati Raj Institutions"), "3b: concept name in the prompt");
  assert(prompt.includes("73rd Amendment"), "3c: keywords in the prompt");
  assert(prompt.includes(QUESTION_CTX.questionText!), "3d: failed question text in the prompt");
  assert(prompt.includes("Student selected: b"), "3e: the student's selection in the prompt");
  assert(prompt.includes("Correct answer: d"), "3f: correct answer in the prompt");
  assert(prompt.includes("I'm not sure what went wrong"), "3g: the student's own words are quoted");

  assert(systemPrompt.includes("Do NOT diagnose the student"), "3h: system prompt forbids diagnosis");
  assert(systemPrompt.includes("Do NOT reteach the concept"), "3i: system prompt forbids reteaching");
  assert(systemPrompt.includes("Do NOT generate a verification question"), "3j: system prompt forbids verification");
  assert(systemPrompt.includes("POSSIBILITIES"), "3k: system prompt frames stumbling points as possibilities");
  assert(aiState.calls[0].format === "json", "3l: JSON format requested");

  // Without question context
  resetAI();
  await executeClarification(executorInput(notSureRequest(null)));
  assert(
    aiState.calls[0].prompt.includes("Do NOT invent details"),
    "3m: missing context forbids inventing details",
  );
  assert(!aiState.calls[0].prompt.includes("Student selected:"), "3n: no selection invented");

  // Prompt should NOT contain verification instructions
  assert(!prompt.includes('"verification"'), "3o: no verification field in the JSON template");

  console.log("  ✓ Prompt targets self-diagnosis without diagnosing or verifying");
}

// ─── 4. Malformed AI output and provider failure ────────────

async function section4() {
  section("4. Malformed AI output and provider failure");

  const bad: { label: string; payload: unknown }[] = [
    { label: "not JSON at all", payload: "Sorry, I can't." },
    { label: "empty string", payload: "" },
    { label: "missing whatTheQuestionNeeded", payload: { ...GOOD_RESPONSE, whatTheQuestionNeeded: undefined } },
    { label: "missing possibleStumblingPoints", payload: { ...GOOD_RESPONSE, possibleStumblingPoints: undefined } },
    { label: "missing nextTimeStrategy", payload: { ...GOOD_RESPONSE, nextTimeStrategy: undefined } },
    { label: "whatTheQuestionNeeded too short", payload: { ...GOOD_RESPONSE, whatTheQuestionNeeded: "eh" } },
    { label: "nextTimeStrategy too long", payload: { ...GOOD_RESPONSE, nextTimeStrategy: "x".repeat(801) } },
    { label: "only 1 stumbling point", payload: { ...GOOD_RESPONSE, possibleStumblingPoints: ["just one thing here, not enough"] } },
    { label: "4 stumbling points", payload: { ...GOOD_RESPONSE, possibleStumblingPoints: ["one is enough words", "two is enough words", "three is enough", "four is too many points"] } },
    { label: "stumbling point too short", payload: { ...GOOD_RESPONSE, possibleStumblingPoints: ["ok", "fine"] } },
    { label: "empty array", payload: { ...GOOD_RESPONSE, possibleStumblingPoints: [] } },
  ];

  for (const { label, payload } of bad) {
    resetAI(payload);
    let threw = false;
    let leaked = false;
    try {
      await executeClarification(executorInput(notSureRequest()));
      leaked = true;
    } catch (err) {
      threw = err instanceof Error;
    }
    assert(threw && !leaked, `4a: rejects ${label}`);
  }

  resetAI("nope");
  let message = "";
  try {
    await executeClarification(executorInput(notSureRequest()));
  } catch (err) {
    message = err instanceof Error ? err.message : "";
  }
  assert(
    message.includes("Clarification AI response validation failed"),
    "4b: rejection names the stage",
  );

  resetAI();
  aiState.throwError = new Error("provider unavailable");
  let propagated = false;
  try {
    await executeClarification(executorInput(notSureRequest()));
  } catch (err) {
    propagated = err instanceof Error && err.message === "provider unavailable";
  }
  assert(propagated, "4c: provider errors propagate unchanged");

  resetAI({ ...GOOD_RESPONSE, howToNarrowItDown: 12 });
  const coerced = await executeClarification(executorInput(notSureRequest()));
  assert(coerced.breakdown.howToNarrowItDown === null, "4d: non-string optional degrades to null");

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
    name: "panchayati-raj",
    displayName: "Panchayati Raj Institutions",
    subject: "Polity",
    keywords: ["73rd Amendment"],
  };

  resetAI();
  const res = await callRepair({
    conceptId: CONCEPT_ID,
    failureReason: "not_sure",
    questionContext: QUESTION_CTX,
  });

  assert(res.status === 200, "5a: route returns 200");
  const repair = res.json.data?.["repair"] as unknown as Record<string, unknown>;
  assert(repair !== null && repair !== undefined, "5b: a repair is returned, not null");
  assert(repair.failureReason === "not_sure", "5c: failureReason echoed unconverted");
  assert(repair.repairIntent === "clarification", "5d: routed to the R3.10 executor");
  assert(repair.breakdown !== undefined, "5e: breakdown returned to the client");
  assert(repair.verification === null, "5f: verification is null in the response");
  assert(repair.explanation === undefined, "5g: no concept-teaching payload");
  assert(repair.retrieval === undefined, "5h: no active-recall payload");

  console.log("  ✓ /api/repair routes not_sure to R3.10");
}

// ─── 6. Verification correctly absent ───────────────────────

async function section6() {
  section("6. Verification is correctly absent — clarification has no MCQ");

  // Attempting to verify a clarification repair should be rejected
  const validation = validateRepairVerification({
    requestId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    conceptId: CONCEPT_ID,
    failureReason: "not_sure",
    repairIntent: "clarification",
    verificationSelectedAnswer: "a",
    verificationCorrectAnswer: "d",
  });

  assert(!validation.success, "6a: R3.3 rejects verification for clarification intent");
  if (!validation.success) {
    assert(
      validation.error.includes("clarification") || validation.error.includes("no executor"),
      "6b: rejection message mentions clarification or missing executor",
    );
  }

  // Verify that clarification is NOT in verifiable intents
  assert(
    !VERIFIABLE_REPAIR_INTENTS.includes("clarification"),
    "6c: clarification is not in VERIFIABLE_REPAIR_INTENTS",
  );

  // The repair itself should have verification = null
  resetAI();
  const req = notSureRequest();
  const repair = await executeClarification(executorInput(req));
  assert(repair.verification === null, "6d: executor output has verification = null");

  // But a tampered request claiming a different intent should also fail
  const tampered = validateRepairVerification({
    requestId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    conceptId: CONCEPT_ID,
    failureReason: "not_sure",
    repairIntent: "concept_teaching",
    verificationSelectedAnswer: "a",
    verificationCorrectAnswer: "d",
  });
  assert(!tampered.success, "6e: not_sure cannot claim concept_teaching intent");

  console.log("  ✓ No verification possible for clarification — by design");
}

// ─── 7. All seven executors coexist ─────────────────────────

async function section7() {
  section("7. All seven executors coexist and guard each other");

  const TEACHING = {
    coreIdea: "Panchayati Raj is a system of rural local self-government constitutionalised by the 73rd Amendment.",
    whyItMatters: "It decentralises governance to the grassroots level.",
    example: "Village Panchayats directly elected by voters handle local issues.",
    keyDistinction: "It applies to rural areas; urban local bodies are covered by the 74th Amendment.",
    verification: VERIFICATION_FIXTURE,
  };
  const RECALL = {
    retrievalPrompt: "Name the committee that recommended the three-tier Panchayati Raj system.",
    cue: "Think about the 1957 recommendation for democratic decentralisation.",
    expectedAnswer: "Balwant Rai Mehta Committee recommended the three-tier system: Village, Block, District.",
    feedback: "If you recalled the committee but not the year, that is the specific gap.",
    verification: VERIFICATION_FIXTURE,
  };
  const INTERPRETATION = {
    whatItAsked: "It asked which committee recommended CREATION, not which amendment constitutionalised it.",
    decisiveWording: "The word 'creation' points to the initial recommendation, not the constitutional amendment.",
    whyYourAnswerMissed: "Selecting the 73rd Amendment is a common confusion between recommendation and constitutionalisation.",
    whatToLookFor: "Distinguish between 'recommended', 'created', and 'constitutionalised' in UPSC questions.",
    verification: VERIFICATION_FIXTURE,
  };
  const UNCERTAINTY = {
    keyDistinction: "Balwant Rai Mehta (1957) recommended creation; Ashok Mehta (1977) recommended restructuring.",
    whyBetterSupported: "The question says 'creation', which is the 1957 recommendation.",
    competingOption: "Ashok Mehta is tempting because of the similar surname.",
    howToDecide: "Ask: does the question say 'creation' or 'reform'? Creation = Balwant Rai Mehta.",
    verification: VERIFICATION_FIXTURE,
  };
  const CALIBRATION = {
    whatYouBelieved: "You likely believed the 73rd Amendment created Panchayati Raj.",
    whatWasActuallyCorrect: "The 73rd Amendment constitutionalised it; the Balwant Rai Mehta Committee recommended its creation.",
    whereConfidenceBroke: "The 73rd Amendment is the most famous milestone, so it feels like the origin — but it came 35 years after the original recommendation.",
    selfCheck: "Ask: 'Am I confusing the constitutionalisation with the original recommendation?'",
    verification: VERIFICATION_FIXTURE,
  };
  const ERROR_AWARENESS = {
    whatWasOverlooked: "The question asked about 'creation' — the Balwant Rai Mehta Committee — not 'constitutionalisation' (73rd Amendment).",
    theTrap: "The 73rd Amendment is the most prominent milestone, so it is easy to select without reading 'creation' carefully.",
    checkingStep: "Re-read the question stem and underline the action verb (created, recommended, constitutionalised) before looking at options.",
    patternAwareness: "Watch for distinction between initial recommendation, implementation, and constitutional status in UPSC governance questions.",
    verification: VERIFICATION_FIXTURE,
  };

  const cases: { label: string; reason: FailureReason; content: unknown; run: (i: never) => Promise<{ repairIntent: string; failureReason: string }> }[] = [
    { label: "concept_teaching", reason: "concept_not_understood", content: TEACHING, run: executeConceptTeaching as never },
    { label: "active_recall", reason: "could_not_recall", content: RECALL, run: executeActiveRecall as never },
    { label: "question_interpretation", reason: "misunderstood_question", content: INTERPRETATION, run: executeQuestionInterpretation as never },
    { label: "uncertainty_resolution", reason: "guessed", content: UNCERTAINTY, run: executeUncertaintyResolution as never },
    { label: "calibration", reason: "overconfident", content: CALIBRATION, run: executeCalibration as never },
    { label: "error_awareness", reason: "careless_mistake", content: ERROR_AWARENESS, run: executeErrorAwareness as never },
    { label: "clarification", reason: "not_sure", content: GOOD_RESPONSE, run: executeClarification as never },
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

  console.log("  ✓ Seven executors, each handling exactly its own intent");
}

// ─── 8. Isolation ───────────────────────────────────────────

section("8. Isolation — no SM-2, no legacy R2, no persistence");
{
  const source = readFileSync(
    join(process.cwd(), "src/lib/repair/clarification.executor.ts"),
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
  assert(source.includes("Do NOT reteach the concept"), "8d: no-reteaching rule is in the system prompt");
  assert(source.includes("Do NOT generate a verification question"), "8e: no-verification rule is in the system prompt");

  console.log("  ✓ Pure executor: AI + validation only, no diagnosis, no verification");
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
  console.log(`\n  ${failed === 0 ? "✅ R3.10 CLARIFICATION: VALIDATED" : "❌ R3.10 CLARIFICATION: ISSUES FOUND"}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Unexpected test harness error:", err);
  process.exit(1);
});
