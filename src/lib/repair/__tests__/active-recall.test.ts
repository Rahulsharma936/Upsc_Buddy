/**
 * R3.5 — Active Recall Executor Validation
 *
 * Deterministic tests for the retrieval repair that serves could_not_recall.
 *
 * Tests:
 *   Section 1: Intent mapping (could_not_recall → active_recall, others intact)
 *   Section 2: Repair generation and structure (AI client stubbed)
 *   Section 3: Prompt targeting — concept + failed-question context are used
 *   Section 4: Malformed AI output is rejected safely
 *   Section 5: Reaches the EXISTING R3.3 verification flow
 *   Section 6: Reaches the EXISTING understanding + R3.4 next-action flow
 *   Section 7: The concept_teaching path is unchanged
 *   Section 8: Isolation — no SM-2, no legacy R2, no persistence, no diagnosis
 *
 * The AI CLIENT is stubbed; the real validation pipeline (JSON repair + the
 * real Zod schema) runs untouched, so Section 4 exercises the actual guard
 * rather than a mock of it. No database, no network.
 *
 * Run: npx tsx src/lib/repair/__tests__/active-recall.test.ts
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
  questionText: "Which Article guarantees freedom of speech and expression?",
  questionId: "q-fr-019",
};

// ─── AI client stub ─────────────────────────────────────────

/**
 * Replaces ONLY the AI client. The response validator and the executor's Zod
 * schema are the real ones, so malformed-output handling is genuinely tested.
 */
const aiState = {
  content: "" as string,
  calls: [] as { prompt: string; systemPrompt: string; format?: string; temperature?: number }[],
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

// Deliberate `require()`: must resolve AFTER the stub above is in the module
// cache. A top-level `import` would be hoisted and would load the real client.
/* eslint-disable @typescript-eslint/no-require-imports */
const { executeActiveRecall } = require("@/lib/repair/active-recall.executor") as typeof import("@/lib/repair/active-recall.executor");
const { executeConceptTeaching } = require("@/lib/repair/concept-teaching.executor") as typeof import("@/lib/repair/concept-teaching.executor");
/* eslint-enable @typescript-eslint/no-require-imports */

const GOOD_RECALL_RESPONSE = {
  retrievalPrompt: "Which Article of the Constitution protects freedom of speech, and which clause allows restricting it?",
  cue: "It sits in Part III, immediately after the right to equality.",
  expectedAnswer: "Article 19(1)(a) guarantees freedom of speech and expression; Article 19(2) allows reasonable restrictions.",
  feedback: "If you reached Part III but stalled on the clause number, the gap is the 19(1)(a) / 19(2) pairing, not the concept itself.",
  verification: {
    question: "Under Article 19(2), which ground is NOT valid for restricting free speech?",
    options: {
      a: "Security of the State",
      b: "Public order",
      c: "Economic interest of the State",
      d: "Decency or morality",
    },
    correctAnswer: "c",
    explanation: "Economic interest is not among the grounds listed in Article 19(2).",
  },
};

function recallRequest(ctx: RepairQuestionContext | null = QUESTION_CTX): RepairRequest {
  return buildRepairRequest({
    failureReason: "could_not_recall",
    conceptId: CONCEPT_ID,
    questionContext: ctx ?? undefined,
  });
}

function executorInput(request: RepairRequest) {
  return {
    request,
    conceptName: "Fundamental Rights",
    conceptSubject: "Polity",
    conceptKeywords: ["Article 19", "Freedom of speech", "Reasonable restrictions"],
  };
}

function resetAI(content: unknown = GOOD_RECALL_RESPONSE): void {
  aiState.content = typeof content === "string" ? content : JSON.stringify(content);
  aiState.calls = [];
  aiState.throwError = null;
}

// ─── 1. Intent mapping ──────────────────────────────────────

section("1. Intent mapping");
{
  const req = recallRequest();
  assert(req.failureReason === "could_not_recall", "1a: failureReason preserved verbatim");
  assert(req.repairIntent === "active_recall", "1b: could_not_recall maps to active_recall");
  assert(req.repairIntent !== "concept_teaching", "1c: NOT routed to concept teaching");
  assert(req.conceptId === CONCEPT_ID, "1d: conceptId carried on the request");
  assert(typeof req.requestId === "string" && req.requestId.length > 0, "1e: requestId minted");

  // The rest of the mapping is untouched.
  const teaching = buildRepairRequest({ failureReason: "concept_not_understood", conceptId: CONCEPT_ID });
  assert(teaching.repairIntent === "concept_teaching", "1f: concept_not_understood still maps to concept_teaching");

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

  console.log("  ✓ could_not_recall routes to active_recall; mapping otherwise intact");
}

// ─── 2. Repair generation and structure ─────────────────────

async function section2() {
  section("2. Repair generation and structure");

  resetAI();
  const req = recallRequest();
  const repair = await executeActiveRecall(executorInput(req));

  // Data integrity — everything the plan requires be preserved.
  assert(repair.requestId === req.requestId, "2a: requestId preserved");
  assert(repair.conceptId === CONCEPT_ID, "2b: conceptId preserved");
  assert(repair.failureReason === "could_not_recall", "2c: failureReason stays could_not_recall");
  assert(repair.repairIntent === "active_recall", "2d: repairIntent stays active_recall");
  assert(repair.questionContext?.questionId === "q-fr-019", "2e: original question context preserved");
  assert(repair.questionContext?.selectedAnswer === "b", "2f: student's original selection preserved");
  assert(repair.status === "ready", "2g: status is ready");
  assert(repair.generatedAt instanceof Date, "2h: generatedAt is a Date");

  // Retrieval comes first and is separate from the reveal.
  assert(repair.retrieval.prompt === GOOD_RECALL_RESPONSE.retrievalPrompt, "2i: retrieval prompt returned");
  assert(repair.retrieval.cue === GOOD_RECALL_RESPONSE.cue, "2j: cue returned");
  assert(repair.reveal.expectedAnswer === GOOD_RECALL_RESPONSE.expectedAnswer, "2k: expected answer returned");
  assert(repair.reveal.feedback === GOOD_RECALL_RESPONSE.feedback, "2l: feedback returned");

  // The reveal is a distinct object, so the UI can gate it behind an attempt.
  assert(
    !("expectedAnswer" in repair.retrieval),
    "2m: the answer is NOT bundled into the retrieval prompt",
  );

  // Verification uses the same four-option contract as concept_teaching.
  assert(Object.keys(repair.verification.options).length === 4, "2n: verification has four options");
  assert(repair.verification.correctAnswer === "c", "2o: verification answer key returned");
  assert(
    repair.verification.question !== QUESTION_CTX.questionText,
    "2p: verification differs from the original question",
  );

  // No teaching payload — this is not a concept lesson.
  const asRecord = repair as unknown as Record<string, unknown>;
  assert(!("explanation" in asRecord), "2q: no concept-teaching explanation block");
  assert(!("coreIdea" in asRecord), "2r: no coreIdea");
  assert(!("whyItMatters" in asRecord), "2s: no whyItMatters");

  // A null cue is allowed.
  resetAI({ ...GOOD_RECALL_RESPONSE, cue: null });
  const noCue = await executeActiveRecall(executorInput(recallRequest()));
  assert(noCue.retrieval.cue === null, "2t: cue may be null");

  // No question context still produces a repair.
  resetAI();
  const noCtx = await executeActiveRecall(executorInput(recallRequest(null)));
  assert(noCtx.questionContext === null, "2u: null question context preserved as null");
  assert(noCtx.retrieval.prompt.length > 0, "2v: repair still generated without question context");

  // Intent guard.
  resetAI();
  const teachingReq = buildRepairRequest({ failureReason: "concept_not_understood", conceptId: CONCEPT_ID });
  let guarded = false;
  try {
    await executeActiveRecall(executorInput(teachingReq));
  } catch (err) {
    guarded = err instanceof Error && err.message.includes("active_recall");
  }
  assert(guarded, "2w: executor rejects a non-active_recall intent");
  assert(aiState.calls.length === 0, "2x: the guard fires before any AI call");

  console.log("  ✓ Retrieval, reveal and verification generated; context preserved");
}

// ─── 3. Prompt targeting ────────────────────────────────────

async function section3() {
  section("3. Prompt targeting — concept and question context are used");

  resetAI();
  await executeActiveRecall(executorInput(recallRequest()));

  assert(aiState.calls.length === 1, "3a: exactly one AI call");
  const { prompt, systemPrompt } = aiState.calls[0];

  assert(prompt.includes("Fundamental Rights"), "3b: concept name in the prompt");
  assert(prompt.includes("Polity"), "3c: subject in the prompt");
  assert(prompt.includes("Article 19"), "3d: keywords in the prompt");
  assert(prompt.includes(QUESTION_CTX.questionText!), "3e: failed question text in the prompt");
  assert(prompt.includes("Student selected: b"), "3f: student's selection in the prompt");
  assert(prompt.includes("Correct answer: d"), "3g: correct answer in the prompt");
  assert(prompt.includes("couldn't recall it"), "3h: the student's own words are quoted");

  // The prompt must ask for retrieval, not a lesson.
  assert(systemPrompt.includes("RETRIEVAL"), "3i: system prompt frames this as retrieval");
  assert(systemPrompt.includes("Do NOT reteach"), "3j: system prompt forbids reteaching");
  assert(
    systemPrompt.includes("what do you remember about X?"),
    "3k: system prompt bans the generic recall prompt",
  );
  assert(aiState.calls[0].format === "json", "3l: JSON format requested, as the sibling executor does");

  // Without question context the prompt says so rather than inventing one.
  resetAI();
  await executeActiveRecall(executorInput(recallRequest(null)));
  assert(
    aiState.calls[0].prompt.includes("No specific question context is available"),
    "3m: missing context is stated, not fabricated",
  );
  assert(
    !aiState.calls[0].prompt.includes("Student selected:"),
    "3n: no answer context invented when none exists",
  );

  console.log("  ✓ Prompt is targeted at the concept and the actual failed question");
}

// ─── 4. Malformed AI output ─────────────────────────────────

async function section4() {
  section("4. Malformed AI output is rejected safely");

  const bad: { label: string; payload: unknown }[] = [
    { label: "not JSON at all", payload: "I'm sorry, I can't do that." },
    { label: "empty string", payload: "" },
    { label: "JSON array", payload: "[]" },
    { label: "missing retrievalPrompt", payload: { ...GOOD_RECALL_RESPONSE, retrievalPrompt: undefined } },
    { label: "missing expectedAnswer", payload: { ...GOOD_RECALL_RESPONSE, expectedAnswer: undefined } },
    { label: "missing feedback", payload: { ...GOOD_RECALL_RESPONSE, feedback: undefined } },
    { label: "missing verification", payload: { ...GOOD_RECALL_RESPONSE, verification: undefined } },
    { label: "retrievalPrompt too short", payload: { ...GOOD_RECALL_RESPONSE, retrievalPrompt: "hm?" } },
    { label: "retrievalPrompt too long (a lecture)", payload: { ...GOOD_RECALL_RESPONSE, retrievalPrompt: "x".repeat(601) } },
    { label: "invalid answer key", payload: { ...GOOD_RECALL_RESPONSE, verification: { ...GOOD_RECALL_RESPONSE.verification, correctAnswer: "e" } } },
    { label: "only three options", payload: { ...GOOD_RECALL_RESPONSE, verification: { ...GOOD_RECALL_RESPONSE.verification, options: { a: "1", b: "2", c: "3" } } } },
    { label: "empty option text", payload: { ...GOOD_RECALL_RESPONSE, verification: { ...GOOD_RECALL_RESPONSE.verification, options: { a: "1", b: "", c: "3", d: "4" } } } },
  ];

  for (const { label, payload } of bad) {
    resetAI(payload);
    let threw = false;
    let leaked = false;
    try {
      await executeActiveRecall(executorInput(recallRequest()));
      leaked = true;
    } catch (err) {
      threw = err instanceof Error;
    }
    assert(threw && !leaked, `4a: rejects ${label}`);
  }

  // The failure is explained, not swallowed into a half-built repair.
  resetAI("not json");
  let message = "";
  try {
    await executeActiveRecall(executorInput(recallRequest()));
  } catch (err) {
    message = err instanceof Error ? err.message : "";
  }
  assert(message.includes("Active recall AI response validation failed"), "4b: rejection names the stage");

  // A provider outage propagates rather than producing a fake repair.
  resetAI();
  aiState.throwError = new Error("provider unavailable");
  let propagated = false;
  try {
    await executeActiveRecall(executorInput(recallRequest()));
  } catch (err) {
    propagated = err instanceof Error && err.message === "provider unavailable";
  }
  assert(propagated, "4c: AI transport errors propagate unchanged");

  // A cue that is not a string degrades to null rather than failing the repair.
  resetAI({ ...GOOD_RECALL_RESPONSE, cue: 42 });
  const coerced = await executeActiveRecall(executorInput(recallRequest()));
  assert(coerced.retrieval.cue === null, "4d: a non-string cue degrades to null");

  console.log("  ✓ Bad AI output never becomes a repair");
}

// ─── 5. Existing R3.3 verification flow ─────────────────────

async function section5() {
  section("5. Reaches the EXISTING R3.3 verification flow");

  assert(
    VERIFIABLE_REPAIR_INTENTS.includes("active_recall"),
    "5a: active_recall is verifiable now that it has an executor",
  );
  assert(
    VERIFIABLE_REPAIR_INTENTS.includes("concept_teaching"),
    "5b: concept_teaching remains verifiable",
  );

  resetAI();
  const req = recallRequest();
  const repair = await executeActiveRecall(executorInput(req));

  // The exact payload PracticeCard posts to the EXISTING /api/repair/verify.
  const validation = validateRepairVerification({
    requestId: repair.requestId,
    conceptId: repair.conceptId,
    failureReason: repair.failureReason,
    repairIntent: repair.repairIntent,
    verificationSelectedAnswer: "c",
    verificationCorrectAnswer: repair.verification.correctAnswer,
    questionContext: { questionIndex: 2, questionId: "q-fr-019" },
    verificationQuestion: repair.verification.question,
  });

  assert(validation.success, "5c: R3.3 accepts an active_recall verification");
  if (!validation.success) throw new Error(validation.error);
  assert(validation.repairIntent === "active_recall", "5d: R3.3 derives active_recall server-side");

  const event = buildRepairVerificationEvent(validation.payload, validation.repairIntent);
  assert(event.eventType === "repair_verification", "5e: the SAME event type is written — no second mechanism");
  assert(event.eventMetadata.requestId === repair.requestId, "5f: requestId correlates repair to verification");
  assert(event.eventMetadata.failureReason === "could_not_recall", "5g: failureReason stored unconverted");
  assert(event.eventMetadata.repairIntent === "active_recall", "5h: repairIntent stored unconverted");
  assert(event.eventMetadata.verificationCorrect === true, "5i: outcome derived from the answer keys");
  assert(event.qualityRating === null && event.mcqCorrect === null, "5j: event stays inert w.r.t. SM-2");

  // A client claiming a mismatched intent is still rejected.
  const tampered = validateRepairVerification({
    requestId: repair.requestId,
    conceptId: repair.conceptId,
    failureReason: "could_not_recall",
    repairIntent: "concept_teaching",
    verificationSelectedAnswer: "c",
    verificationCorrectAnswer: "c",
  });
  assert(!tampered.success, "5k: could_not_recall cannot claim concept_teaching");

  console.log("  ✓ Active recall verifies through the existing R3.3 mechanism");
}

// ─── 6. Existing understanding + R3.4 flow ──────────────────

async function section6() {
  section("6. Reaches the EXISTING understanding + next-action flow");

  resetAI();
  const req = recallRequest();
  const repair = await executeActiveRecall(executorInput(req));

  const validation = validateRepairVerification({
    requestId: repair.requestId,
    conceptId: repair.conceptId,
    failureReason: repair.failureReason,
    repairIntent: repair.repairIntent,
    verificationSelectedAnswer: "a",
    verificationCorrectAnswer: repair.verification.correctAnswer,
  });
  if (!validation.success) throw new Error(validation.error);
  const event = buildRepairVerificationEvent(validation.payload, validation.repairIntent);

  // R3.3 understanding derives its context from the stored verification.
  const derived = deriveRepairContext(event.eventMetadata);
  assert(derived.success, "6a: understanding derives context from an active_recall verification");
  if (!derived.success) throw new Error(derived.error);
  assert(derived.context.failureReason === "could_not_recall", "6b: derived failureReason unconverted");
  assert(derived.context.repairIntent === "active_recall", "6c: derived repairIntent unconverted");
  assert(derived.context.conceptId === CONCEPT_ID, "6d: derived conceptId correct");

  // R3.4 decides the next action from the same two facts, unchanged.
  assert(
    decideNextAction({ verificationCorrect: false, postRepairUnderstanding: "still_not_understood" }) === "offer_another_repair",
    "6e: R3.4 still offers another repair on the recall path",
  );
  assert(
    decideNextAction({ verificationCorrect: true, postRepairUnderstanding: "understood" }) === "repair_complete",
    "6f: R3.4 still completes on the recall path",
  );

  console.log("  ✓ Understanding and next-action work unchanged for active recall");
}

// ─── 7. concept_teaching unchanged ──────────────────────────

async function section7() {
  section("7. The concept_teaching path is unchanged");

  const GOOD_TEACHING_RESPONSE = {
    coreIdea: "Article 19 guarantees six freedoms, including speech and expression.",
    whyItMatters: "It defines the scope of civil liberties and the limits the State may impose.",
    example: "A protest ban must satisfy the reasonable-restrictions test under Article 19(2).",
    keyDistinction: "Article 19 covers speech; Article 21 covers life and liberty.",
    verification: GOOD_RECALL_RESPONSE.verification,
  };

  resetAI(GOOD_TEACHING_RESPONSE);
  const req = buildRepairRequest({
    failureReason: "concept_not_understood",
    conceptId: CONCEPT_ID,
    questionContext: QUESTION_CTX,
  });
  const repair = await executeConceptTeaching(executorInput(req));

  assert(repair.failureReason === "concept_not_understood", "7a: teaching failureReason unchanged");
  assert(repair.repairIntent === "concept_teaching", "7b: teaching repairIntent unchanged");
  assert(repair.explanation.coreIdea === GOOD_TEACHING_RESPONSE.coreIdea, "7c: coreIdea still returned");
  assert(repair.explanation.whyItMatters.length > 0, "7d: whyItMatters still returned");
  assert(repair.explanation.example !== null, "7e: example still returned");
  assert(repair.explanation.keyDistinction !== null, "7f: keyDistinction still returned");
  assert(repair.verification.correctAnswer === "c", "7g: teaching verification still returned");
  assert(repair.status === "ready", "7h: teaching status unchanged");

  // No retrieval payload leaked into the teaching repair.
  const asRecord = repair as unknown as Record<string, unknown>;
  assert(!("retrieval" in asRecord), "7i: teaching repair has no retrieval block");
  assert(!("reveal" in asRecord), "7j: teaching repair has no reveal block");

  // The teaching executor still refuses active_recall.
  resetAI(GOOD_TEACHING_RESPONSE);
  let guarded = false;
  try {
    await executeConceptTeaching(executorInput(recallRequest()));
  } catch (err) {
    guarded = err instanceof Error && err.message.includes("concept_teaching");
  }
  assert(guarded, "7k: teaching executor rejects active_recall");

  console.log("  ✓ concept_teaching behaves exactly as before");
}

// ─── 8. Isolation ───────────────────────────────────────────

section("8. Isolation — no SM-2, no legacy R2, no persistence");
{
  const source = readFileSync(
    join(process.cwd(), "src/lib/repair/active-recall.executor.ts"),
    "utf-8",
  );
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  const forbidden = [
    "lib/diagnostic", "spaced-repetition", "revision-intelligence",
    "revision.repository", "concept.repository", "@/lib/db", "supabase",
    "logEvent", "recordReview", "conceptMastery", "qualityRating",
    "concept_gap", "memory_gap", "calibration_gap", "revision_gap",
    "diagnosis", "resolved", "score",
  ];
  for (const token of forbidden) {
    assert(!code.includes(token), `8a: executor code never references "${token}"`);
  }

  // Its runtime imports are the SAME two the sibling executor already uses.
  const runtimeImports = code
    .split("\n")
    .filter((l) => /^\s*import\s+(?!type\b)/.test(l))
    .map((l) => l.trim());
  assert(runtimeImports.length === 4, "8b: four runtime imports (zod, ai client, validator, note-grounding)");
  assert(code.includes('from "./note-grounding"'), "8b2: grounds on the existing Knowledge note via the pure note-grounding helper");
  const grounding = readFileSync(join(process.cwd(), "src/lib/repair/note-grounding.ts"), "utf8");
  assert(!/^\s*import\s/m.test(grounding), "8b3: note-grounding has no imports at all — pure formatting");
  assert(code.includes('from "@/lib/ai/client"'), "8c: uses the existing AI client");
  assert(code.includes('from "@/lib/ai/utils/response-validator"'), "8d: uses the existing validator");

  // No new evidence event type is introduced by R3.5.
  assert(!code.includes("EVENT_TYPE"), "8e: declares no new event type");
  assert(!code.includes("repair_understanding"), "8f: does not touch the understanding event");

  console.log("  ✓ Pure executor: AI + validation only, no persistence or scoring");
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

  console.log(`\n  ${failed === 0 ? "✅ R3.5 ACTIVE RECALL: VALIDATED" : "❌ R3.5 ACTIVE RECALL: ISSUES FOUND"}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Unexpected test harness error:", err);
  process.exit(1);
});
