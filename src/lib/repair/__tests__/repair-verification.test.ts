/**
 * R3.3 — Repair Verification Validation
 *
 * Deterministic tests for persisting the outcome of a repair's verification MCQ.
 *
 * Tests:
 *   Section 1: Payload validation (Zod, strict)
 *   Section 2: Correct verification persists correctly
 *   Section 3: Incorrect verification persists correctly
 *   Section 4: Correlation — requestId / conceptId / failureReason / repairIntent preserved
 *   Section 5: SM-2 isolation (event is inert w.r.t. scheduling)
 *   Section 6: Evidence layer normalization + backward compatibility
 *   Section 7: R3.1 → R3.2a → R3.3 end-to-end requestId survival
 *   Section 8: API integration — auth, validation, persistence (route handler, stubbed deps)
 *   Section 9: API integration — duplicate submission handling
 *   Section 10: API integration — SM-2 never invoked
 *
 * No database, no AI, no network. The route handler runs in-process with
 * its data-access dependencies stubbed via the module cache.
 *
 * Run: npx tsx src/lib/repair/__tests__/repair-verification.test.ts
 */

import {
  validateRepairVerification,
  buildRepairVerificationEvent,
  repairVerificationPayloadSchema,
  REPAIR_VERIFICATION_EVENT_TYPE,
  VERIFIABLE_REPAIR_INTENTS,
} from "@/lib/repair/repair-verification";
import type { RepairVerificationPayload } from "@/lib/repair/repair-verification";
import { buildRepairRequest, ALL_FAILURE_REASONS } from "@/lib/repair/repair-request.builder";
import { normalizeEvent } from "@/lib/evidence/evidence.normalizer";
import type { RevisionEventRecord } from "@/types/database.types";
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

const REQUEST_ID = "3f1e4c2a-1b2c-4d5e-8f90-abcdef123456";
const CONCEPT_ID = "9a8b7c6d-5e4f-4a3b-9c8d-123456789abc";
const OTHER_REQUEST_ID = "11111111-2222-4333-8444-555555555555";

function validPayload(
  overrides: Partial<RepairVerificationPayload> = {},
): Record<string, unknown> {
  return {
    requestId: REQUEST_ID,
    conceptId: CONCEPT_ID,
    failureReason: "concept_not_understood",
    repairIntent: "concept_teaching",
    verificationSelectedAnswer: "c",
    verificationCorrectAnswer: "c",
    questionContext: { questionIndex: 2, questionId: "q-fr-019" },
    verificationQuestion: "Under Article 19(2), which ground is NOT valid?",
    ...overrides,
  };
}

/** Validate + build in one step; throws if validation fails. */
function buildFrom(body: Record<string, unknown>) {
  const v = validateRepairVerification(body);
  if (!v.success) throw new Error(`unexpected validation failure: ${v.error}`);
  return buildRepairVerificationEvent(v.payload, v.repairIntent, new Date("2026-09-02T10:00:00.000Z"));
}

// ─── 1. Payload validation ──────────────────────────────────

section("1. Payload validation (Zod, strict)");
{
  assert(validateRepairVerification(validPayload()).success, "1a: valid payload accepted");

  assert(!validateRepairVerification({}).success, "1b: empty body rejected");
  assert(!validateRepairVerification(null).success, "1c: null body rejected");
  assert(!validateRepairVerification("nope").success, "1d: string body rejected");
  assert(
    !validateRepairVerification(validPayload({ requestId: "not-a-uuid" as never })).success,
    "1e: non-uuid requestId rejected",
  );
  assert(
    !validateRepairVerification(validPayload({ conceptId: "not-a-uuid" as never })).success,
    "1f: non-uuid conceptId rejected",
  );
  assert(
    !validateRepairVerification(validPayload({ failureReason: "made_up_reason" as never })).success,
    "1g: unknown failureReason rejected",
  );
  assert(
    !validateRepairVerification(validPayload({ verificationSelectedAnswer: "z" as never })).success,
    "1h: invalid selected answer key rejected",
  );
  assert(
    !validateRepairVerification(validPayload({ verificationCorrectAnswer: "" as never })).success,
    "1i: empty correct answer key rejected",
  );

  // Anti-tamper: the client cannot assert its own correctness verdict.
  const withVerdict = { ...validPayload(), verificationCorrect: true };
  assert(
    !validateRepairVerification(withVerdict).success,
    "1j: client-supplied verificationCorrect rejected (strict)",
  );

  // Anti-tamper: unknown fields never reach stored evidence.
  const withJunk = { ...validPayload(), qualityRating: 5, nextReviewAt: "2030-01-01" };
  assert(
    !validateRepairVerification(withJunk).success,
    "1k: unknown/SM-2-shaped fields rejected (strict)",
  );

  // Anti-tamper: repairIntent must match the R3.1 mapping of failureReason.
  assert(
    !validateRepairVerification(validPayload({ repairIntent: "calibration" })).success,
    "1l: mismatched repairIntent rejected",
  );

  // Intents with no executor cannot be verified — no fabricated evidence.
  // (calibration is now implemented via R3.8; not_sure -> clarification is the remaining unexercised intent)
  const noExecutor = validateRepairVerification(
    validPayload({ failureReason: "not_sure", repairIntent: "clarification" }),
  );
  assert(!noExecutor.success, "1m: intent without an executor rejected");
  assert(
    !noExecutor.success && noExecutor.error.includes("no executor"),
    "1n: rejection explains the missing executor",
  );

  // Optional fields really are optional.
  const minimal = validPayload();
  delete (minimal as Record<string, unknown>).questionContext;
  delete (minimal as Record<string, unknown>).verificationQuestion;
  assert(validateRepairVerification(minimal).success, "1o: questionContext/verificationQuestion optional");

  // Bounded input.
  assert(
    !validateRepairVerification(validPayload({ verificationQuestion: "x".repeat(1501) })).success,
    "1p: over-long verificationQuestion rejected",
  );
  assert(
    !validateRepairVerification(
      validPayload({ questionContext: { questionIndex: -1 } as never }),
    ).success,
    "1q: negative questionIndex rejected",
  );
  assert(
    repairVerificationPayloadSchema.safeParse(validPayload()).success,
    "1r: exported schema parses a valid payload",
  );

  console.log("  ✓ Payload validation: strict, bounded, tamper-resistant");
}

// ─── 2. Correct verification ────────────────────────────────

section("2. Correct verification persists correctly");
{
  const ev = buildFrom(validPayload({ verificationSelectedAnswer: "c", verificationCorrectAnswer: "c" }));

  assert(ev.eventType === "repair_verification", "2a: eventType is repair_verification");
  assert(ev.eventType === REPAIR_VERIFICATION_EVENT_TYPE, "2b: eventType matches exported constant");
  assert(ev.eventMetadata.verificationCorrect === true, "2c: verificationCorrect is true");
  assert(ev.eventMetadata.verificationSelectedAnswer === "c", "2d: selected answer stored");
  assert(ev.eventMetadata.verificationCorrectAnswer === "c", "2e: correct answer stored");
  assert(typeof ev.eventMetadata.verifiedAt === "string", "2f: verifiedAt is a string");
  assert(
    !Number.isNaN(Date.parse(ev.eventMetadata.verifiedAt)),
    "2g: verifiedAt is a parseable ISO timestamp",
  );
  assert(ev.eventMetadata.questionId === "q-fr-019", "2h: originating questionId preserved");
  assert(ev.eventMetadata.questionIndex === 2, "2i: originating questionIndex preserved");
  assert(
    ev.eventMetadata.verificationQuestion === "Under Article 19(2), which ground is NOT valid?",
    "2j: verification question text preserved",
  );

  console.log("  ✓ Correct verification: full evidence captured");
}

// ─── 3. Incorrect verification ──────────────────────────────

section("3. Incorrect verification persists correctly");
{
  const ev = buildFrom(validPayload({ verificationSelectedAnswer: "a", verificationCorrectAnswer: "d" }));

  assert(ev.eventMetadata.verificationCorrect === false, "3a: verificationCorrect is false");
  assert(ev.eventMetadata.verificationSelectedAnswer === "a", "3b: wrong selection stored verbatim");
  assert(ev.eventMetadata.verificationCorrectAnswer === "d", "3c: correct key still stored");
  assert(ev.eventType === "repair_verification", "3d: same event type regardless of outcome");
  assert(ev.qualityRating === null, "3e: failed verification carries no quality rating");

  // Correctness is derived, never trusted from the client.
  for (const [sel, cor, expected] of [
    ["a", "a", true], ["b", "b", true], ["c", "d", false], ["d", "a", false],
  ] as const) {
    const e = buildFrom(validPayload({ verificationSelectedAnswer: sel, verificationCorrectAnswer: cor }));
    assert(e.eventMetadata.verificationCorrect === expected, `3f: ${sel} vs ${cor} → ${expected}`);
  }

  console.log("  ✓ Incorrect verification: outcome derived server-side");
}

// ─── 4. Correlation fields preserved ────────────────────────

section("4. requestId / conceptId / failureReason / repairIntent preserved");
{
  const ev = buildFrom(validPayload());

  assert(ev.eventMetadata.requestId === REQUEST_ID, "4a: requestId preserved exactly");
  assert(ev.eventMetadata.conceptId === CONCEPT_ID, "4b: conceptId preserved exactly");
  assert(ev.eventMetadata.failureReason === "concept_not_understood", "4c: failureReason preserved");
  assert(ev.eventMetadata.repairIntent === "concept_teaching", "4d: repairIntent preserved");

  // No new ID is minted during verification.
  assert(
    JSON.stringify(ev.eventMetadata).includes(REQUEST_ID),
    "4e: the R3.1 requestId is the only request identifier in the payload",
  );
  assert(
    !JSON.stringify(ev.eventMetadata).includes(OTHER_REQUEST_ID),
    "4f: no unrelated request id introduced",
  );

  // A different requestId flows through untouched.
  const ev2 = buildFrom(validPayload({ requestId: OTHER_REQUEST_ID }));
  assert(ev2.eventMetadata.requestId === OTHER_REQUEST_ID, "4g: arbitrary requestId round-trips");

  // repairIntent is DERIVED, not echoed: it always equals the R3.1 mapping.
  assert(
    ev.eventMetadata.repairIntent === buildRepairRequest({
      failureReason: "concept_not_understood",
      conceptId: CONCEPT_ID,
    }).repairIntent,
    "4h: stored repairIntent equals the R3.1 mapping",
  );

  console.log("  ✓ Repair correlation intact across the loop");
}

// ─── 5. SM-2 isolation ──────────────────────────────────────

section("5. SM-2 isolation");
{
  const ev = buildFrom(validPayload());

  assert(ev.qualityRating === null, "5a: qualityRating is null");
  assert(ev.mcqCorrect === null, "5b: mcqCorrect is null (R2 accuracy untouched)");
  assert(ev.mcqQuestionIndex === null, "5c: mcqQuestionIndex column is null");

  const metaKeys = Object.keys(ev.eventMetadata);
  const sm2Keys = [
    "quality", "qualityRating", "easeFactor", "previousEase", "newEase",
    "intervalDays", "previousInterval", "newInterval",
    "repetitionCount", "nextReviewAt", "lastReviewedAt", "masteryLevel",
  ];
  for (const k of sm2Keys) {
    assert(!metaKeys.includes(k), `5d: metadata carries no SM-2 field "${k}"`);
  }

  // Runtime check (cast past the literal type): the emitted value must never be
  // one of the event types that DO flow through SM-2.
  const emittedType: string = ev.eventType;
  assert(emittedType !== "mcq_attempt", "5e: not recorded as an MCQ attempt");
  assert(emittedType !== "review", "5f: not recorded as a review");
  assert(emittedType !== "self_assessment", "5g: not recorded as a self-assessment");

  console.log("  ✓ Verification event is inert with respect to SM-2");
}

// ─── 6. Evidence normalization ──────────────────────────────

section("6. Evidence layer normalization + backward compatibility");
{
  const ev = buildFrom(validPayload({ verificationSelectedAnswer: "a", verificationCorrectAnswer: "c" }));

  const record: RevisionEventRecord = {
    id: "event-uuid-1",
    userId: "user-1",
    conceptId: CONCEPT_ID,
    eventType: ev.eventType,
    qualityRating: ev.qualityRating,
    mcqCorrect: ev.mcqCorrect,
    mcqQuestionIndex: ev.mcqQuestionIndex,
    eventMetadata: ev.eventMetadata,
    createdAt: new Date("2026-09-02T10:00:00.000Z"),
  };

  const norm = normalizeEvent(record);

  assert(norm.eventType === "repair_verification", "6a: event type recognised (not 'unknown')");
  assert(norm.rawEventType === "repair_verification", "6b: raw event type preserved");
  assert(norm.repairRequestId === REQUEST_ID, "6c: repairRequestId normalized");
  assert(norm.repairIntent === "concept_teaching", "6d: repairIntent normalized");
  assert(norm.verificationCorrect === false, "6e: verificationCorrect normalized");
  assert(norm.failureReason === "concept_not_understood", "6f: failureReason normalized");
  assert(norm.qualityRating === null, "6g: normalized qualityRating stays null");
  assert(norm.mcqCorrect === null, "6h: normalized mcqCorrect stays null");

  // Backward compatibility: pre-R3.3 events must be unaffected.
  const legacy: RevisionEventRecord = {
    id: "event-uuid-2",
    userId: "user-1",
    conceptId: CONCEPT_ID,
    eventType: "mcq_attempt",
    qualityRating: 4,
    mcqCorrect: true,
    mcqQuestionIndex: 1,
    eventMetadata: { confidence: 3, questionId: "q-1" },
    createdAt: new Date("2026-08-01T10:00:00.000Z"),
  };
  const legacyNorm = normalizeEvent(legacy);
  assert(legacyNorm.eventType === "mcq_attempt", "6i: legacy mcq_attempt still recognised");
  assert(legacyNorm.repairRequestId === null, "6j: legacy event has null repairRequestId");
  assert(legacyNorm.repairIntent === null, "6k: legacy event has null repairIntent");
  assert(legacyNorm.verificationCorrect === null, "6l: legacy event has null verificationCorrect");
  assert(legacyNorm.confidence === 3, "6m: legacy confidence still normalized");
  assert(legacyNorm.mcqCorrect === true, "6n: legacy mcqCorrect still normalized");

  // Unknown event types still degrade safely.
  const unknown = normalizeEvent({ ...legacy, eventType: "some_future_type" });
  assert(unknown.eventType === "unknown", "6o: unknown event type degrades to 'unknown'");
  assert(unknown.rawEventType === "some_future_type", "6p: unknown raw type preserved");

  // A malformed repairIntent in metadata must not leak through.
  const bogus = normalizeEvent({
    ...record,
    eventMetadata: { ...ev.eventMetadata, repairIntent: "concept_gap" },
  });
  assert(bogus.repairIntent === null, "6q: legacy 4-gap value rejected as a repairIntent");

  const missing = normalizeEvent({ ...record, eventMetadata: {} });
  assert(missing.repairRequestId === null, "6r: missing metadata → null repairRequestId");
  assert(missing.verificationCorrect === null, "6s: missing metadata → null verificationCorrect");

  console.log("  ✓ Evidence layer reads R3.3 events; legacy events unaffected");
}

// ─── 7. End-to-end requestId survival ───────────────────────

section("7. R3.1 → R3.2a → R3.3 requestId survival");
{
  // R3.1: student reports the cause.
  const req = buildRepairRequest({
    failureReason: "concept_not_understood",
    conceptId: CONCEPT_ID,
    questionContext: { questionIndex: 2, selectedAnswer: "b", correctAnswer: "d", questionId: "q-fr-019" },
  });
  assert(req.repairIntent === "concept_teaching", "7a: R3.1 produced concept_teaching");

  // R3.2a would generate teaching + a verification MCQ carrying req.requestId.
  // R3.3: the student answers it.
  const ev = buildFrom(validPayload({
    requestId: req.requestId,
    conceptId: req.conceptId,
    failureReason: req.failureReason,
    repairIntent: req.repairIntent,
  }));

  assert(ev.eventMetadata.requestId === req.requestId, "7b: R3.1 requestId reaches the R3.3 event");
  assert(ev.eventMetadata.conceptId === req.conceptId, "7c: conceptId reaches the R3.3 event");
  assert(ev.eventMetadata.failureReason === req.failureReason, "7d: failureReason reaches the R3.3 event");
  assert(ev.eventMetadata.repairIntent === req.repairIntent, "7e: repairIntent reaches the R3.3 event");

  // Only concept_teaching is verifiable in R3.2a.
  // The verifiable set grows as executors land. Asserted as a set, not by position.
  assert(VERIFIABLE_REPAIR_INTENTS.length === 6, "7f: six verifiable intents with R3.8 and R3.9 landed");
  for (const intent of [
    "concept_teaching", "active_recall", "question_interpretation", "uncertainty_resolution", "calibration", "error_awareness",
  ] as const) {
    assert(VERIFIABLE_REPAIR_INTENTS.includes(intent), `7g: ${intent} is verifiable`);
  }

  let rejected = 0;
  for (const reason of ALL_FAILURE_REASONS as FailureReason[]) {
    const r = buildRepairRequest({ failureReason: reason, conceptId: CONCEPT_ID });
    const v = validateRepairVerification(validPayload({
      failureReason: reason,
      repairIntent: r.repairIntent,
    }));
    if (!v.success) rejected++;
  }
  assert(rejected === 1, "7i: 1 of 7 failure reasons (not_sure -> clarification) still has no verifiable executor");

  console.log("  ✓ R3.1 → R3.2a → R3.3 pipeline flow validated");
}

// ─── API integration harness ────────────────────────────────

/**
 * Runs the real POST handler from src/app/api/repair/verify/route.ts with its
 * data-access dependencies stubbed through the module cache. No DB, no network.
 */

type LoggedEvent = Record<string, unknown>;

const apiState = {
  user: { id: "user-1" } as { id: string } | null,
  concept: { userId: "user-1" } as { userId: string } | undefined,
  existing: undefined as { id: string; eventMetadata: Record<string, unknown> } | undefined,
  logged: [] as LoggedEvent[],
  masteryCalls: [] as string[],
  sm2Calls: [] as string[],
};

function stubModule(spec: string, exports: Record<string, unknown>): void {
  const resolved = require.resolve(spec);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as never;
}

stubModule("@/lib/supabase/server", {
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: apiState.user } }) },
  }),
});

stubModule("@/lib/repositories/concept.repository", {
  conceptRepository: {
    findById: async () => apiState.concept,
  },
});

stubModule("@/lib/repositories/revision.repository", {
  revisionRepository: {
    findRepairVerification: async () => apiState.existing,
    logEvent: async (data: LoggedEvent) => {
      apiState.logged.push(data);
      return { id: `event-${apiState.logged.length}`, ...data };
    },
    // Any SM-2 / mastery touch is a test failure.
    upsertMastery: async () => { apiState.masteryCalls.push("upsertMastery"); return {}; },
    getMastery: async () => { apiState.masteryCalls.push("getMastery"); return undefined; },
  },
});

// Tripwires: if the route ever reaches the scheduling path, these record it.
stubModule("@/lib/ai/services/spaced-repetition.engine", {
  calculateNextState: () => { apiState.sm2Calls.push("calculateNextState"); throw new Error("SM-2 INVOKED"); },
  handleSkip: () => { apiState.sm2Calls.push("handleSkip"); throw new Error("SM-2 INVOKED"); },
  initializeMastery: () => { apiState.sm2Calls.push("initializeMastery"); throw new Error("SM-2 INVOKED"); },
});

stubModule("@/lib/ai/services/revision-intelligence.service", {
  revisionIntelligenceService: {
    recordReview: async () => { apiState.sm2Calls.push("recordReview"); throw new Error("SM-2 INVOKED"); },
    recordSkip: async () => { apiState.sm2Calls.push("recordSkip"); throw new Error("SM-2 INVOKED"); },
  },
});

// Deliberate `require()`: these must resolve AFTER the stubs above are placed
// in the module cache. A top-level `import` would be hoisted and would load the
// real Supabase/DB modules first, defeating the stubs.
/* eslint-disable @typescript-eslint/no-require-imports */
const verifyRoute = require("@/app/api/repair/verify/route") as {
  POST: (req: unknown) => Promise<Response>;
};
const { NextRequest } = require("next/server") as { NextRequest: new (url: string, init: RequestInit) => unknown };
/* eslint-enable @typescript-eslint/no-require-imports */

async function callVerify(body: unknown): Promise<{ status: number; json: Record<string, never> }> {
  const req = new NextRequest("http://localhost/api/repair/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const res = await verifyRoute.POST(req);
  return { status: res.status, json: await res.json() };
}

function resetApiState(): void {
  apiState.user = { id: "user-1" };
  apiState.concept = { userId: "user-1" };
  apiState.existing = undefined;
  apiState.logged = [];
  apiState.masteryCalls = [];
  apiState.sm2Calls = [];
}

// ─── 8. API integration ─────────────────────────────────────

async function section8() {
  section("8. API integration — auth, validation, persistence");

  // Unauthenticated.
  resetApiState();
  apiState.user = null;
  const unauth = await callVerify(validPayload());
  assert(unauth.status === 401, "8a: unauthenticated request rejected with 401");
  assert(apiState.logged.length === 0, "8b: unauthenticated request persists nothing");

  // Invalid payload.
  resetApiState();
  const invalid = await callVerify({ requestId: "nope" });
  assert(invalid.status === 400, "8c: invalid payload rejected with 400");
  assert(apiState.logged.length === 0, "8d: invalid payload persists nothing");

  // Malformed JSON.
  resetApiState();
  const badJson = await callVerify("{not json");
  assert(badJson.status === 400, "8e: malformed JSON rejected with 400");
  assert(apiState.logged.length === 0, "8f: malformed JSON persists nothing");

  // Unknown extra field (strict).
  resetApiState();
  const extra = await callVerify({ ...validPayload(), verificationCorrect: true });
  assert(extra.status === 400, "8g: client-supplied verificationCorrect rejected with 400");

  // Concept not owned by the caller.
  resetApiState();
  apiState.concept = { userId: "someone-else" };
  const foreign = await callVerify(validPayload());
  assert(foreign.status === 404, "8h: foreign concept rejected with 404");
  assert(apiState.logged.length === 0, "8i: foreign concept persists nothing");

  // Concept missing.
  resetApiState();
  apiState.concept = undefined;
  const missing = await callVerify(validPayload());
  assert(missing.status === 404, "8j: missing concept rejected with 404");

  // Happy path — correct answer.
  resetApiState();
  const ok = await callVerify(validPayload());
  assert(ok.status === 200, "8k: valid verification returns 200");
  assert(ok.json.success === true, "8l: response reports success");
  assert(apiState.logged.length === 1, "8m: exactly one event persisted");

  const row = apiState.logged[0] as {
    userId: string; conceptId: string; eventType: string;
    qualityRating: unknown; mcqCorrect: unknown; mcqQuestionIndex: unknown;
    eventMetadata: Record<string, unknown>;
  };
  assert(row.eventType === "repair_verification", "8n: persisted eventType is repair_verification");
  assert(row.userId === "user-1", "8o: persisted under the authenticated user");
  assert(row.conceptId === CONCEPT_ID, "8p: persisted against the right concept");
  assert(row.eventMetadata.requestId === REQUEST_ID, "8q: persisted requestId matches R3.1");
  assert(row.eventMetadata.failureReason === "concept_not_understood", "8r: persisted failureReason");
  assert(row.eventMetadata.repairIntent === "concept_teaching", "8s: persisted repairIntent");
  assert(row.eventMetadata.verificationCorrect === true, "8t: persisted verificationCorrect true");
  assert(row.qualityRating === null, "8u: persisted qualityRating is null");
  assert(row.mcqCorrect === null, "8v: persisted mcqCorrect is null");

  // Happy path — wrong answer.
  resetApiState();
  const wrong = await callVerify(validPayload({ verificationSelectedAnswer: "b", verificationCorrectAnswer: "c" }));
  assert(wrong.status === 200, "8w: incorrect verification also returns 200");
  const wrongRow = apiState.logged[0] as { eventMetadata: Record<string, unknown> };
  assert(wrongRow.eventMetadata.verificationCorrect === false, "8x: persisted verificationCorrect false");
  assert(wrong.json.data?.["verificationCorrect"] === false, "8y: response echoes the derived outcome");

  console.log("  ✓ API: authenticates, validates, persists exactly one event");
}

// ─── 9. Duplicate submission ────────────────────────────────

async function section9() {
  section("9. API integration — duplicate submission handling");

  // Second submit for the same requestId must not append a second event.
  resetApiState();
  const first = await callVerify(validPayload());
  assert(first.status === 200, "9a: first submission succeeds");
  assert(apiState.logged.length === 1, "9b: first submission persists one event");
  assert(first.json.data?.["duplicate"] === false, "9c: first submission not flagged duplicate");

  // Simulate the now-persisted event being found on the retry.
  apiState.existing = {
    id: "event-1",
    eventMetadata: { requestId: REQUEST_ID, verificationCorrect: true },
  };

  const second = await callVerify(validPayload());
  assert(second.status === 200, "9d: duplicate submission returns 200, not an error");
  assert(second.json.success === true, "9e: duplicate submission reports success");
  assert(apiState.logged.length === 1, "9f: duplicate submission persists NO second event");
  assert(second.json.data?.["duplicate"] === true, "9g: duplicate flagged in the response");
  assert(second.json.data?.["eventId"] === "event-1", "9h: duplicate returns the original event id");
  assert(
    second.json.data?.["verificationCorrect"] === true,
    "9i: duplicate returns the original outcome, not the resubmitted one",
  );

  // A changed answer on resubmit must not overwrite the recorded outcome.
  const tamper = await callVerify(validPayload({ verificationSelectedAnswer: "a", verificationCorrectAnswer: "d" }));
  assert(apiState.logged.length === 1, "9j: resubmit with a different answer persists nothing new");
  assert(tamper.json.data?.["verificationCorrect"] === true, "9k: original outcome preserved");

  // A different repair (different requestId) is still verifiable.
  resetApiState();
  apiState.existing = undefined;
  await callVerify(validPayload({ requestId: OTHER_REQUEST_ID }));
  assert(apiState.logged.length === 1, "9l: a different requestId still records its own event");

  console.log("  ✓ Duplicate verification is idempotent by requestId");
}

// ─── 10. SM-2 never invoked ─────────────────────────────────

async function section10() {
  section("10. API integration — SM-2 never invoked");

  resetApiState();
  await callVerify(validPayload());

  assert(apiState.sm2Calls.length === 0, "10a: no SM-2 engine function called");
  assert(apiState.masteryCalls.length === 0, "10b: no concept_mastery read or write");
  assert(apiState.logged.length === 1, "10c: the write went to revision_events only");

  const row = apiState.logged[0] as Record<string, unknown>;
  const rowKeys = Object.keys(row);
  for (const k of ["easeFactor", "intervalDays", "repetitionCount", "nextReviewAt", "lastReviewedAt", "masteryLevel"]) {
    assert(!rowKeys.includes(k), `10d: inserted row carries no SM-2 column "${k}"`);
  }

  // Repeat across outcomes — neither a pass nor a fail may reach SM-2.
  resetApiState();
  await callVerify(validPayload({ verificationSelectedAnswer: "a", verificationCorrectAnswer: "b" }));
  assert(apiState.sm2Calls.length === 0, "10e: failed verification does not reach SM-2 either");
  assert(apiState.masteryCalls.length === 0, "10f: failed verification does not touch mastery");

  console.log("  ✓ SM-2 and concept mastery are untouched by verification");
}

// ─── Summary ────────────────────────────────────────────────

async function main(): Promise<void> {
  await section8();
  await section9();
  await section10();

  section("RESULTS");

  console.log(`\n  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);

  if (failures.length > 0) {
    console.log(`\n  Failures:`);
    failures.forEach((f) => console.log(`    - ${f}`));
  }

  console.log(`\n  ${failed === 0 ? "✅ R3.3 REPAIR VERIFICATION: VALIDATED" : "❌ R3.3 REPAIR VERIFICATION: ISSUES FOUND"}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Unexpected test harness error:", err);
  process.exit(1);
});
