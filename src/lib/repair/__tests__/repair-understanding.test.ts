/**
 * R3.3 — Post-Repair Student Self-Assessment Validation
 *
 * Deterministic tests for recording what the student SAYS about a concept
 * after a repair and its verification MCQ.
 *
 * Tests:
 *   Section 1: Payload validation (Zod, strict) — the client sends two fields
 *   Section 2: Server-side derivation from the stored verification evidence
 *   Section 3: Event shape — verbatim value, SM-2 nulls, no judgment fields
 *   Section 4: Verification outcome × self-report combinations (raw facts only)
 *   Section 5: Evidence layer normalization + backward compatibility
 *   Section 6: R3.1 → R3.2a → R3.3 verification → R3.3 understanding correlation
 *   Section 7: API integration — auth, derivation, 404s, persistence
 *   Section 8: API integration — duplicate submission handling
 *   Section 9: API integration — SM-2 never invoked, legacy R2 metrics unaffected
 *
 * No database, no AI, no network. The route handler runs in-process with
 * its data-access dependencies stubbed via the module cache.
 *
 * Nothing here asserts a MEANING for any combination of verification outcome
 * and self-report. That interpretation is R3.4's, and R3.4 does not exist.
 * These tests only prove the raw facts are stored, correlated, and inert.
 *
 * Run: npx tsx src/lib/repair/__tests__/repair-understanding.test.ts
 */

import {
  validateRepairUnderstanding,
  deriveRepairContext,
  buildRepairUnderstandingEvent,
  repairUnderstandingPayloadSchema,
  REPAIR_UNDERSTANDING_EVENT_TYPE,
  ALL_POST_REPAIR_UNDERSTANDING,
} from "@/lib/repair/repair-understanding";
import type {
  RepairUnderstandingPayload,
  DerivedRepairContext,
} from "@/lib/repair/repair-understanding";
import {
  buildRepairVerificationEvent,
  validateRepairVerification,
} from "@/lib/repair/repair-verification";
import { buildRepairRequest } from "@/lib/repair/repair-request.builder";
import { normalizeEvent } from "@/lib/evidence/evidence.normalizer";
import type { RevisionEventRecord } from "@/types/database.types";

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
const DECOY_CONCEPT_ID = "deadbeef-0000-4000-8000-000000000001";

const REPORTED_AT = new Date("2026-09-03T12:00:00.000Z");

/** The exact set of keys the stored metadata is allowed to contain. */
const ALLOWED_METADATA_KEYS = [
  "requestId",
  "conceptId",
  "failureReason",
  "repairIntent",
  "postRepairUnderstanding",
  "reportedAt",
];

/** Keys that would turn this evidence into a verdict. None may ever appear. */
const FORBIDDEN_METADATA_KEYS = [
  "verificationCorrect", "qualityRating", "mcqCorrect", "mcqQuestionIndex",
  "resolved", "status", "score", "confidence", "selfAssessment",
  "studentDifficulty", "repairEffectiveness", "learningScore", "diagnosis",
  "conceptGap", "memoryGap", "calibrationGap", "compositeIndex",
  "easeFactor", "previousEase", "newEase", "intervalDays",
  "previousInterval", "newInterval", "repetitionCount", "nextReviewAt",
  "lastReviewedAt", "masteryLevel",
];

function validPayload(
  overrides: Partial<RepairUnderstandingPayload> = {},
): Record<string, unknown> {
  return {
    requestId: REQUEST_ID,
    postRepairUnderstanding: "understood",
    ...overrides,
  };
}

const VALID_CONTEXT: DerivedRepairContext = {
  conceptId: CONCEPT_ID,
  failureReason: "concept_not_understood",
  repairIntent: "concept_teaching",
};

/** Metadata as a real repair_verification event stores it. */
function verificationMetadata(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const v = validateRepairVerification({
    requestId: REQUEST_ID,
    conceptId: CONCEPT_ID,
    failureReason: "concept_not_understood",
    repairIntent: "concept_teaching",
    verificationSelectedAnswer: "c",
    verificationCorrectAnswer: "c",
  });
  if (!v.success) throw new Error(`fixture build failed: ${v.error}`);
  const ev = buildRepairVerificationEvent(v.payload, v.repairIntent);
  return { ...ev.eventMetadata, ...overrides };
}

/** Validate + build in one step; throws if validation fails. */
function buildFrom(
  body: Record<string, unknown>,
  context: DerivedRepairContext = VALID_CONTEXT,
) {
  const v = validateRepairUnderstanding(body);
  if (!v.success) throw new Error(`unexpected validation failure: ${v.error}`);
  return buildRepairUnderstandingEvent(v.payload, context, REPORTED_AT);
}

// ─── 1. Payload validation ──────────────────────────────────

section("1. Payload validation (Zod, strict)");
{
  // All three values the student can report are accepted.
  for (const value of ALL_POST_REPAIR_UNDERSTANDING) {
    assert(
      validateRepairUnderstanding(validPayload({ postRepairUnderstanding: value })).success,
      `1a: "${value}" accepted`,
    );
  }
  assert(ALL_POST_REPAIR_UNDERSTANDING.length === 3, "1b: exactly three reportable values");
  assert(ALL_POST_REPAIR_UNDERSTANDING[0] === "understood", "1c: first value is understood");
  assert(ALL_POST_REPAIR_UNDERSTANDING[1] === "somewhat_unsure", "1d: second value is somewhat_unsure");
  assert(ALL_POST_REPAIR_UNDERSTANDING[2] === "still_not_understood", "1e: third value is still_not_understood");

  assert(!validateRepairUnderstanding({}).success, "1f: empty body rejected");
  assert(!validateRepairUnderstanding(null).success, "1g: null body rejected");
  assert(!validateRepairUnderstanding("nope").success, "1h: string body rejected");
  assert(
    !validateRepairUnderstanding(validPayload({ requestId: "not-a-uuid" as never })).success,
    "1i: non-uuid requestId rejected",
  );
  assert(
    !validateRepairUnderstanding({ postRepairUnderstanding: "understood" }).success,
    "1j: missing requestId rejected",
  );
  assert(
    !validateRepairUnderstanding({ requestId: REQUEST_ID }).success,
    "1k: missing postRepairUnderstanding rejected",
  );

  // Invalid enum values.
  assert(
    !validateRepairUnderstanding(validPayload({ postRepairUnderstanding: "confident" as never })).success,
    "1l: unknown enum value rejected",
  );
  assert(
    !validateRepairUnderstanding(validPayload({ postRepairUnderstanding: "" as never })).success,
    "1m: empty enum value rejected",
  );
  assert(
    !validateRepairUnderstanding(validPayload({ postRepairUnderstanding: 3 as never })).success,
    "1n: numeric score rejected — this is not a 1-3 scale",
  );
  assert(
    !validateRepairUnderstanding(validPayload({ postRepairUnderstanding: "UNDERSTOOD" as never })).success,
    "1o: wrong-case enum value rejected",
  );

  // Anti-tamper: every derived field must be refused from the client.
  const forbiddenClientFields: Record<string, unknown> = {
    conceptId: CONCEPT_ID,
    failureReason: "concept_not_understood",
    repairIntent: "concept_teaching",
    verificationCorrect: true,
    qualityRating: 5,
    mcqCorrect: true,
    resolved: true,
    status: "resolved",
    score: 0.9,
    reportedAt: "2020-01-01T00:00:00.000Z",
    userId: "user-2",
    nextReviewAt: "2030-01-01",
  };
  for (const [key, value] of Object.entries(forbiddenClientFields)) {
    assert(
      !validateRepairUnderstanding({ ...validPayload(), [key]: value }).success,
      `1p: client-supplied "${key}" rejected (strict)`,
    );
  }

  // Unknown junk in general.
  assert(
    !validateRepairUnderstanding({ ...validPayload(), somethingElse: 1 }).success,
    "1q: arbitrary unknown key rejected (strict)",
  );
  assert(
    repairUnderstandingPayloadSchema.safeParse(validPayload()).success,
    "1r: exported schema parses a valid payload",
  );

  const parsedKeys = Object.keys(
    repairUnderstandingPayloadSchema.parse(validPayload()) as Record<string, unknown>,
  ).sort();
  assert(
    JSON.stringify(parsedKeys) === JSON.stringify(["postRepairUnderstanding", "requestId"]),
    "1s: parsed payload carries exactly the two client fields",
  );

  console.log("  ✓ Payload validation: two fields, strict, tamper-resistant");
}

// ─── 2. Server-side derivation ──────────────────────────────

section("2. Server-side derivation from stored verification");
{
  const ok = deriveRepairContext(verificationMetadata());
  assert(ok.success, "2a: valid verification metadata derives a context");
  assert(ok.success && ok.context.conceptId === CONCEPT_ID, "2b: conceptId derived from stored evidence");
  assert(
    ok.success && ok.context.failureReason === "concept_not_understood",
    "2c: failureReason derived from stored evidence",
  );
  assert(
    ok.success && ok.context.repairIntent === "concept_teaching",
    "2d: repairIntent derived from stored evidence",
  );

  // The stored value wins over anything a caller might prefer.
  const otherConcept = deriveRepairContext(
    verificationMetadata({ conceptId: DECOY_CONCEPT_ID }),
  );
  assert(
    otherConcept.success && otherConcept.context.conceptId === DECOY_CONCEPT_ID,
    "2e: derivation reads the stored conceptId, whatever it is",
  );

  // Row-column fallback when metadata predates the field.
  const noConceptInMeta = verificationMetadata();
  delete noConceptInMeta.conceptId;
  const viaFallback = deriveRepairContext(noConceptInMeta, CONCEPT_ID);
  assert(
    viaFallback.success && viaFallback.context.conceptId === CONCEPT_ID,
    "2f: falls back to the verification row's conceptId column",
  );

  assert(
    !deriveRepairContext(noConceptInMeta).success,
    "2g: no conceptId anywhere → derivation fails",
  );

  // Unusable stored evidence must not produce a half-built event.
  const badReason = verificationMetadata({ failureReason: "made_up_reason" });
  assert(!deriveRepairContext(badReason).success, "2h: unknown stored failureReason rejected");

  const noReason = verificationMetadata();
  delete noReason.failureReason;
  assert(!deriveRepairContext(noReason).success, "2i: missing stored failureReason rejected");

  const legacyIntent = verificationMetadata({ repairIntent: "concept_gap" });
  assert(!deriveRepairContext(legacyIntent).success, "2j: legacy 4-gap value rejected as a repairIntent");

  const noIntent = verificationMetadata();
  delete noIntent.repairIntent;
  assert(!deriveRepairContext(noIntent).success, "2k: missing stored repairIntent rejected");

  assert(!deriveRepairContext(null).success, "2l: null metadata rejected");
  assert(!deriveRepairContext({}).success, "2m: empty metadata rejected");
  assert(!deriveRepairContext("nope").success, "2n: non-object metadata rejected");

  console.log("  ✓ Derivation reads stored evidence only, and fails closed");
}

// ─── 3. Event shape ─────────────────────────────────────────

section("3. Event shape — verbatim value, SM-2 nulls, no judgment");
{
  const ev = buildFrom(validPayload({ postRepairUnderstanding: "somewhat_unsure" }));

  assert(ev.eventType === "repair_understanding", "3a: eventType is repair_understanding");
  assert(ev.eventType === REPAIR_UNDERSTANDING_EVENT_TYPE, "3b: eventType matches exported constant");
  assert(
    ev.eventMetadata.postRepairUnderstanding === "somewhat_unsure",
    "3c: student's value stored verbatim",
  );
  assert(ev.eventMetadata.requestId === REQUEST_ID, "3d: requestId preserved verbatim");
  assert(ev.eventMetadata.conceptId === CONCEPT_ID, "3e: derived conceptId stored");
  assert(ev.eventMetadata.failureReason === "concept_not_understood", "3f: derived failureReason stored");
  assert(ev.eventMetadata.repairIntent === "concept_teaching", "3g: derived repairIntent stored");
  assert(ev.eventMetadata.reportedAt === REPORTED_AT.toISOString(), "3h: reportedAt is the injected time");
  assert(!Number.isNaN(Date.parse(ev.eventMetadata.reportedAt)), "3i: reportedAt is a parseable ISO timestamp");

  // SM-2 isolation.
  assert(ev.qualityRating === null, "3j: qualityRating is null");
  assert(ev.mcqCorrect === null, "3k: mcqCorrect is null (R2 accuracy untouched)");
  assert(ev.mcqQuestionIndex === null, "3l: mcqQuestionIndex is null");

  // The emitted type must never be one that DOES flow through SM-2.
  const emittedType: string = ev.eventType;
  assert(emittedType !== "mcq_attempt", "3m: not recorded as an MCQ attempt");
  assert(emittedType !== "review", "3n: not recorded as a review");
  assert(emittedType !== "self_assessment", "3o: not recorded as a self-assessment");
  assert(emittedType !== "repair_verification", "3p: not recorded as a verification");

  // Exactly the allowed keys, and nothing that reads as a verdict.
  const metaKeys = Object.keys(ev.eventMetadata).sort();
  assert(
    JSON.stringify(metaKeys) === JSON.stringify([...ALLOWED_METADATA_KEYS].sort()),
    "3q: metadata carries exactly the six specified keys",
  );
  for (const k of FORBIDDEN_METADATA_KEYS) {
    assert(!metaKeys.includes(k), `3r: metadata carries no "${k}"`);
  }

  console.log("  ✓ Event records the student's answer and nothing else");
}

// ─── 4. Verification outcome × self-report combinations ─────

section("4. Verification outcome × self-report combinations");
{
  // Each combination is stored as two INDEPENDENT facts. The pair is never
  // collapsed into a verdict here, and nothing in the understanding event
  // reveals which way the verification went.
  const outcomes: { label: string; selected: "a" | "c"; correct: "c" }[] = [
    { label: "correct verification", selected: "c", correct: "c" },
    { label: "incorrect verification", selected: "a", correct: "c" },
  ];

  for (const outcome of outcomes) {
    const v = validateRepairVerification({
      requestId: REQUEST_ID,
      conceptId: CONCEPT_ID,
      failureReason: "concept_not_understood",
      repairIntent: "concept_teaching",
      verificationSelectedAnswer: outcome.selected,
      verificationCorrectAnswer: outcome.correct,
    });
    if (!v.success) throw new Error("fixture failed");
    const verificationEvent = buildRepairVerificationEvent(v.payload, v.repairIntent);
    const wasCorrect = outcome.selected === outcome.correct;

    assert(
      verificationEvent.eventMetadata.verificationCorrect === wasCorrect,
      `4a: ${outcome.label} recorded on its own event`,
    );

    for (const value of ALL_POST_REPAIR_UNDERSTANDING) {
      const derived = deriveRepairContext(verificationEvent.eventMetadata);
      if (!derived.success) throw new Error("derivation failed");

      const ev = buildFrom(
        validPayload({ postRepairUnderstanding: value }),
        derived.context,
      );

      assert(
        ev.eventMetadata.postRepairUnderstanding === value,
        `4b: ${outcome.label} + "${value}" → value stored verbatim`,
      );
      assert(
        ev.eventMetadata.requestId === verificationEvent.eventMetadata.requestId,
        `4c: ${outcome.label} + "${value}" → same requestId as the verification`,
      );
      assert(
        !("verificationCorrect" in ev.eventMetadata),
        `4d: ${outcome.label} + "${value}" → outcome not copied onto the report`,
      );
      assert(
        !("resolved" in ev.eventMetadata) && !("status" in ev.eventMetadata),
        `4e: ${outcome.label} + "${value}" → no resolution verdict computed`,
      );
      assert(
        ev.qualityRating === null && ev.mcqCorrect === null,
        `4f: ${outcome.label} + "${value}" → inert with respect to SM-2`,
      );
    }
  }

  // Independence: the report is byte-identical regardless of the outcome.
  const passCtx = deriveRepairContext(verificationMetadata());
  const failCtx = deriveRepairContext(verificationMetadata({ verificationCorrect: false }));
  if (!passCtx.success || !failCtx.success) throw new Error("derivation failed");
  const afterPass = buildFrom(validPayload({ postRepairUnderstanding: "understood" }), passCtx.context);
  const afterFail = buildFrom(validPayload({ postRepairUnderstanding: "understood" }), failCtx.context);
  assert(
    JSON.stringify(afterPass) === JSON.stringify(afterFail),
    "4g: the self-report event does not vary with the verification outcome",
  );

  console.log("  ✓ Six combinations stored as raw, uninterpreted facts");
}

// ─── 5. Evidence normalization ──────────────────────────────

section("5. Evidence layer normalization + backward compatibility");
{
  const ev = buildFrom(validPayload({ postRepairUnderstanding: "still_not_understood" }));

  const record: RevisionEventRecord = {
    id: "event-uuid-1",
    userId: "user-1",
    conceptId: CONCEPT_ID,
    eventType: ev.eventType,
    qualityRating: ev.qualityRating,
    mcqCorrect: ev.mcqCorrect,
    mcqQuestionIndex: ev.mcqQuestionIndex,
    eventMetadata: ev.eventMetadata,
    createdAt: REPORTED_AT,
  };

  const norm = normalizeEvent(record);

  assert(norm.eventType === "repair_understanding", "5a: event type recognised (not 'unknown')");
  assert(norm.rawEventType === "repair_understanding", "5b: raw event type preserved");
  assert(
    norm.postRepairUnderstanding === "still_not_understood",
    "5c: postRepairUnderstanding extracted",
  );
  assert(norm.repairRequestId === REQUEST_ID, "5d: shared requestId key still normalizes");
  assert(norm.repairIntent === "concept_teaching", "5e: shared repairIntent key still normalizes");
  assert(norm.failureReason === "concept_not_understood", "5f: failureReason normalized");
  assert(norm.qualityRating === null, "5g: normalized qualityRating stays null");
  assert(norm.mcqCorrect === null, "5h: normalized mcqCorrect stays null");
  assert(norm.verificationCorrect === null, "5i: no verification outcome on this event");
  assert(norm.confidence === null, "5j: not conflated with R1.2 confidence");
  assert(norm.selfAssessment === null, "5k: not conflated with R1.3 selfAssessment");
  assert(norm.studentDifficulty === null, "5l: not conflated with R2 studentDifficulty");

  // Every valid value round-trips.
  for (const value of ALL_POST_REPAIR_UNDERSTANDING) {
    const n = normalizeEvent({
      ...record,
      eventMetadata: { ...ev.eventMetadata, postRepairUnderstanding: value },
    });
    assert(n.postRepairUnderstanding === value, `5m: "${value}" round-trips through the normalizer`);
  }

  // Invalid values normalize safely to null rather than leaking through.
  const invalidValues = ["confident", "UNDERSTOOD", "", "resolved", 3, true, null, {}];
  for (const bad of invalidValues) {
    const n = normalizeEvent({
      ...record,
      eventMetadata: { ...ev.eventMetadata, postRepairUnderstanding: bad },
    });
    assert(
      n.postRepairUnderstanding === null,
      `5n: invalid value ${JSON.stringify(bad)} normalizes to null`,
    );
  }

  const missing = normalizeEvent({ ...record, eventMetadata: {} });
  assert(missing.postRepairUnderstanding === null, "5o: missing metadata → null");

  // Backward compatibility: existing event types are unaffected.
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
  assert(legacyNorm.eventType === "mcq_attempt", "5p: R1.2 mcq_attempt still recognised");
  assert(legacyNorm.confidence === 3, "5q: R1.2 confidence still normalized");
  assert(legacyNorm.mcqCorrect === true, "5r: R1.2 mcqCorrect still normalized");
  assert(legacyNorm.postRepairUnderstanding === null, "5s: legacy event has null postRepairUnderstanding");

  const r13: RevisionEventRecord = {
    ...legacy,
    eventType: "self_assessment",
    eventMetadata: { selfAssessment: "partially" },
  };
  assert(normalizeEvent(r13).selfAssessment === "partially", "5t: R1.3 self_assessment still normalized");
  assert(
    normalizeEvent(r13).postRepairUnderstanding === null,
    "5u: R1.3 event has null postRepairUnderstanding",
  );

  const r2: RevisionEventRecord = {
    ...legacy,
    eventType: "self_report",
    eventMetadata: { studentDifficulty: "memory_retrieval" },
  };
  assert(
    normalizeEvent(r2).studentDifficulty === "memory_retrieval",
    "5v: R2 self_report still normalized",
  );

  const r33: RevisionEventRecord = {
    ...legacy,
    eventType: "repair_verification",
    qualityRating: null,
    mcqCorrect: null,
    eventMetadata: verificationMetadata(),
  };
  const r33Norm = normalizeEvent(r33);
  assert(r33Norm.eventType === "repair_verification", "5w: R3.3 verification still recognised");
  assert(r33Norm.verificationCorrect === true, "5x: R3.3 verificationCorrect still normalized");
  assert(
    r33Norm.postRepairUnderstanding === null,
    "5y: R3.3 verification has null postRepairUnderstanding",
  );

  const unknown = normalizeEvent({ ...legacy, eventType: "some_future_type" });
  assert(unknown.eventType === "unknown", "5z: unknown event type still degrades to 'unknown'");

  console.log("  ✓ Evidence layer reads the new event; existing events unaffected");
}

// ─── 6. End-to-end correlation ──────────────────────────────

section("6. R3.1 → R3.2a → verification → understanding correlation");
{
  // R3.1: student reports the cause.
  const req = buildRepairRequest({
    failureReason: "concept_not_understood",
    conceptId: CONCEPT_ID,
    questionContext: { questionIndex: 2, selectedAnswer: "b", correctAnswer: "d", questionId: "q-fr-019" },
  });
  assert(req.repairIntent === "concept_teaching", "6a: R3.1 produced concept_teaching");

  // R3.2a delivers the repair; R3.3 records the verification.
  const v = validateRepairVerification({
    requestId: req.requestId,
    conceptId: req.conceptId,
    failureReason: req.failureReason,
    repairIntent: req.repairIntent,
    verificationSelectedAnswer: "a",
    verificationCorrectAnswer: "c",
  });
  if (!v.success) throw new Error("verification fixture failed");
  const verification = buildRepairVerificationEvent(v.payload, v.repairIntent);

  // R3.3: the student self-reports. Only the requestId travels from the client.
  const derived = deriveRepairContext(verification.eventMetadata);
  if (!derived.success) throw new Error("derivation failed");
  const understanding = buildFrom(
    validPayload({ requestId: req.requestId, postRepairUnderstanding: "somewhat_unsure" }),
    derived.context,
  );

  assert(
    understanding.eventMetadata.requestId === req.requestId,
    "6b: R3.1 requestId reaches the understanding event",
  );
  assert(
    understanding.eventMetadata.requestId === verification.eventMetadata.requestId,
    "6c: understanding and verification share one requestId",
  );
  assert(
    understanding.eventMetadata.conceptId === req.conceptId,
    "6d: conceptId survives the whole loop",
  );
  assert(
    understanding.eventMetadata.failureReason === req.failureReason,
    "6e: original failureReason survives the whole loop",
  );
  assert(
    understanding.eventMetadata.repairIntent === req.repairIntent,
    "6f: repairIntent survives the whole loop",
  );

  // No second identifier was introduced anywhere.
  const idLikeKeys = Object.keys(understanding.eventMetadata).filter(
    (k) => /id$/i.test(k),
  ).sort();
  assert(
    JSON.stringify(idLikeKeys) === JSON.stringify(["conceptId", "requestId"]),
    "6g: no new correlation identifier introduced",
  );

  // The verification event itself is untouched by any of this.
  const snapshot = JSON.stringify(verification);
  deriveRepairContext(verification.eventMetadata);
  buildRepairUnderstandingEvent(
    { requestId: req.requestId, postRepairUnderstanding: "understood" },
    derived.context,
    REPORTED_AT,
  );
  assert(JSON.stringify(verification) === snapshot, "6h: the verification event is never mutated");

  console.log("  ✓ One requestId spans R3.1 → R3.2a → verification → understanding");
}

// ─── API integration harness ────────────────────────────────

/**
 * Runs the real POST handler from src/app/api/repair/understanding/route.ts with
 * its data-access dependencies stubbed through the module cache. No DB, no network.
 *
 * The stubbed repository holds a real in-memory event store scoped by
 * (userId, eventType, requestId), so user-scoping and idempotency are exercised
 * the way the SQL lookup would exercise them.
 */

type StoredEvent = {
  id: string;
  userId: string;
  conceptId: string;
  eventType: string;
  eventMetadata: Record<string, unknown>;
};

const apiState = {
  user: { id: "user-1" } as { id: string } | null,
  events: [] as StoredEvent[],
  logged: [] as Record<string, unknown>[],
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

stubModule("@/lib/repositories/revision.repository", {
  revisionRepository: {
    findRepairEventByRequestId: async (
      userId: string,
      eventType: string,
      requestId: string,
    ) =>
      apiState.events.find(
        (e) =>
          e.userId === userId &&
          e.eventType === eventType &&
          e.eventMetadata?.requestId === requestId,
      ),
    findRepairVerification: async (userId: string, requestId: string) =>
      apiState.events.find(
        (e) =>
          e.userId === userId &&
          e.eventType === "repair_verification" &&
          e.eventMetadata?.requestId === requestId,
      ),
    logEvent: async (data: Record<string, unknown>) => {
      apiState.logged.push(data);
      const record = { id: `event-${apiState.logged.length}`, ...data };
      apiState.events.push(record as unknown as StoredEvent);
      return record;
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
const understandingRoute = require("@/app/api/repair/understanding/route") as {
  POST: (req: unknown) => Promise<Response>;
};
const { NextRequest } = require("next/server") as { NextRequest: new (url: string, init: RequestInit) => unknown };
/* eslint-enable @typescript-eslint/no-require-imports */

async function callUnderstanding(body: unknown): Promise<{ status: number; json: Record<string, never> }> {
  const req = new NextRequest("http://localhost/api/repair/understanding", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const res = await understandingRoute.POST(req);
  return { status: res.status, json: await res.json() };
}

/** Seed a stored repair_verification event, as R3.3 would have written it. */
function seedVerification(opts: {
  userId?: string;
  requestId?: string;
  conceptId?: string;
  metadata?: Record<string, unknown>;
} = {}): void {
  const requestId = opts.requestId ?? REQUEST_ID;
  const conceptId = opts.conceptId ?? CONCEPT_ID;
  apiState.events.push({
    id: `verification-${apiState.events.length + 1}`,
    userId: opts.userId ?? "user-1",
    conceptId,
    eventType: "repair_verification",
    eventMetadata:
      opts.metadata ?? verificationMetadata({ requestId, conceptId }),
  });
}

function resetApiState(): void {
  apiState.user = { id: "user-1" };
  apiState.events = [];
  apiState.logged = [];
  apiState.masteryCalls = [];
  apiState.sm2Calls = [];
}

// ─── 7. API integration ─────────────────────────────────────

async function section7() {
  section("7. API integration — auth, derivation, 404s, persistence");

  // Unauthenticated.
  resetApiState();
  apiState.user = null;
  seedVerification();
  const unauth = await callUnderstanding(validPayload());
  assert(unauth.status === 401, "7a: unauthenticated request rejected with 401");
  assert(apiState.logged.length === 0, "7b: unauthenticated request persists nothing");

  // Invalid payload.
  resetApiState();
  seedVerification();
  const invalid = await callUnderstanding({ requestId: "nope", postRepairUnderstanding: "understood" });
  assert(invalid.status === 400, "7c: invalid requestId rejected with 400");
  assert(apiState.logged.length === 0, "7d: invalid payload persists nothing");

  resetApiState();
  seedVerification();
  const badEnum = await callUnderstanding(validPayload({ postRepairUnderstanding: "confident" as never }));
  assert(badEnum.status === 400, "7e: invalid enum value rejected with 400");

  // Malformed JSON.
  resetApiState();
  seedVerification();
  const badJson = await callUnderstanding("{not json");
  assert(badJson.status === 400, "7f: malformed JSON rejected with 400");
  assert(apiState.logged.length === 0, "7g: malformed JSON persists nothing");

  // Every server-derived field is refused from the client, at the route.
  for (const key of ["conceptId", "failureReason", "repairIntent", "verificationCorrect", "qualityRating"]) {
    resetApiState();
    seedVerification();
    const res = await callUnderstanding({ ...validPayload(), [key]: "x" });
    assert(res.status === 400, `7h: client-supplied "${key}" rejected with 400`);
    assert(apiState.logged.length === 0, `7i: client-supplied "${key}" persists nothing`);
  }

  // No verification for this requestId at all.
  resetApiState();
  const noVerification = await callUnderstanding(validPayload());
  assert(noVerification.status === 404, "7j: missing verification rejected with 404");
  assert(apiState.logged.length === 0, "7k: missing verification persists nothing");

  // Verification exists, but belongs to a different user.
  resetApiState();
  seedVerification({ userId: "user-2" });
  const foreign = await callUnderstanding(validPayload());
  assert(foreign.status === 404, "7l: another user's verification is a 404");
  assert(apiState.logged.length === 0, "7m: another user's verification persists nothing");

  // A verification for a DIFFERENT requestId does not unlock this one.
  resetApiState();
  seedVerification({ requestId: OTHER_REQUEST_ID });
  const wrongRequest = await callUnderstanding(validPayload());
  assert(wrongRequest.status === 404, "7n: a different repair's verification is a 404");

  // Unusable stored verification fails closed.
  resetApiState();
  seedVerification({ metadata: { requestId: REQUEST_ID } });
  const unusable = await callUnderstanding(validPayload());
  assert(unusable.status === 400, "7o: underivable stored verification rejected");
  assert(apiState.logged.length === 0, "7p: underivable stored verification persists nothing");

  // Happy path.
  resetApiState();
  seedVerification();
  const ok = await callUnderstanding(validPayload({ postRepairUnderstanding: "somewhat_unsure" }));
  assert(ok.status === 200, "7q: valid self-report returns 200");
  assert(ok.json.success === true, "7r: response reports success");
  assert(apiState.logged.length === 1, "7s: exactly one event persisted");

  const row = apiState.logged[0] as {
    userId: string; conceptId: string; eventType: string;
    qualityRating: unknown; mcqCorrect: unknown; mcqQuestionIndex: unknown;
    eventMetadata: Record<string, unknown>;
  };
  assert(row.eventType === "repair_understanding", "7t: persisted eventType is repair_understanding");
  assert(row.userId === "user-1", "7u: persisted under the authenticated user");
  assert(row.conceptId === CONCEPT_ID, "7v: persisted against the derived concept");
  assert(row.eventMetadata.requestId === REQUEST_ID, "7w: persisted requestId matches R3.1");
  assert(
    row.eventMetadata.postRepairUnderstanding === "somewhat_unsure",
    "7x: persisted value is exactly what the student sent",
  );
  assert(row.eventMetadata.failureReason === "concept_not_understood", "7y: failureReason derived, not sent");
  assert(row.eventMetadata.repairIntent === "concept_teaching", "7z: repairIntent derived, not sent");
  assert(row.qualityRating === null, "7aa: persisted qualityRating is null");
  assert(row.mcqCorrect === null, "7ab: persisted mcqCorrect is null");
  assert(row.mcqQuestionIndex === null, "7ac: persisted mcqQuestionIndex is null");
  assert(
    JSON.stringify(Object.keys(row.eventMetadata).sort()) ===
      JSON.stringify([...ALLOWED_METADATA_KEYS].sort()),
    "7ad: persisted metadata carries exactly the six specified keys",
  );
  for (const k of FORBIDDEN_METADATA_KEYS) {
    assert(!(k in row.eventMetadata), `7ae: persisted metadata carries no "${k}"`);
  }

  // The derivation really comes from the store, not from any client hint.
  resetApiState();
  seedVerification({
    metadata: verificationMetadata({
      requestId: REQUEST_ID,
      conceptId: DECOY_CONCEPT_ID,
      failureReason: "could_not_recall",
      repairIntent: "active_recall",
    }),
  });
  await callUnderstanding(validPayload());
  const derivedRow = apiState.logged[0] as { conceptId: string; eventMetadata: Record<string, unknown> };
  assert(derivedRow.conceptId === DECOY_CONCEPT_ID, "7af: conceptId taken from the stored verification");
  assert(
    derivedRow.eventMetadata.failureReason === "could_not_recall",
    "7ag: failureReason taken from the stored verification",
  );
  assert(
    derivedRow.eventMetadata.repairIntent === "active_recall",
    "7ah: repairIntent taken from the stored verification",
  );

  // All three values survive the round trip through the route.
  for (const value of ALL_POST_REPAIR_UNDERSTANDING) {
    resetApiState();
    seedVerification();
    const res = await callUnderstanding(validPayload({ postRepairUnderstanding: value }));
    const persisted = apiState.logged[0] as { eventMetadata: Record<string, unknown> };
    assert(res.status === 200, `7ai: "${value}" accepted by the route`);
    assert(
      persisted.eventMetadata.postRepairUnderstanding === value,
      `7aj: "${value}" persisted verbatim`,
    );
    assert(res.json.data?.["postRepairUnderstanding"] === value, `7ak: "${value}" echoed back`);
  }

  console.log("  ✓ API authenticates, derives server-side, appends exactly one event");
}

// ─── 8. Duplicate submission ────────────────────────────────

async function section8() {
  section("8. API integration — duplicate submission handling");

  resetApiState();
  seedVerification();

  const first = await callUnderstanding(validPayload({ postRepairUnderstanding: "understood" }));
  assert(first.status === 200, "8a: first submission succeeds");
  assert(apiState.logged.length === 1, "8b: first submission persists one event");
  assert(first.json.data?.["duplicate"] === false, "8c: first submission not flagged duplicate");
  assert(first.json.data?.["eventId"] === "event-1", "8d: first submission returns its event id");

  const second = await callUnderstanding(validPayload({ postRepairUnderstanding: "understood" }));
  assert(second.status === 200, "8e: duplicate submission returns 200, not an error");
  assert(second.json.success === true, "8f: duplicate submission reports success");
  assert(apiState.logged.length === 1, "8g: duplicate submission persists NO second event");
  assert(second.json.data?.["duplicate"] === true, "8h: duplicate flagged in the response");
  assert(second.json.data?.["eventId"] === "event-1", "8i: duplicate returns the original event id");
  assert(
    second.json.data?.["postRepairUnderstanding"] === "understood",
    "8j: duplicate returns the original value",
  );

  // A changed answer on resubmit must not overwrite the recorded report.
  const tamper = await callUnderstanding(
    validPayload({ postRepairUnderstanding: "still_not_understood" }),
  );
  assert(apiState.logged.length === 1, "8k: resubmit with a different value persists nothing new");
  assert(
    tamper.json.data?.["postRepairUnderstanding"] === "understood",
    "8l: the original report is preserved, not replaced",
  );
  assert(tamper.json.data?.["duplicate"] === true, "8m: the tampering resubmit is flagged duplicate");

  // The verification event is untouched throughout.
  const verifications = apiState.events.filter((e) => e.eventType === "repair_verification");
  assert(verifications.length === 1, "8n: still exactly one verification event");
  assert(
    verifications[0].eventMetadata.verificationCorrect === true,
    "8o: the verification event was never modified",
  );

  const understandings = apiState.events.filter((e) => e.eventType === "repair_understanding");
  assert(understandings.length === 1, "8p: exactly one understanding event exists in the store");

  // A different repair is still reportable.
  resetApiState();
  seedVerification({ requestId: OTHER_REQUEST_ID });
  await callUnderstanding(validPayload({ requestId: OTHER_REQUEST_ID }));
  assert(apiState.logged.length === 1, "8q: a different requestId records its own event");

  // Another user's identical requestId is isolated.
  resetApiState();
  seedVerification({ userId: "user-1" });
  seedVerification({ userId: "user-2" });
  await callUnderstanding(validPayload());
  assert(apiState.logged.length === 1, "8r: user-1 records their own report");
  apiState.user = { id: "user-2" };
  await callUnderstanding(validPayload());
  assert(apiState.logged.length === 2, "8s: user-2's identical requestId is not treated as a duplicate");

  console.log("  ✓ Self-assessment is idempotent by requestId, per user");
}

// ─── 9. SM-2 isolation + legacy R2 metrics ──────────────────

async function section9() {
  section("9. API integration — SM-2 never invoked, R2 metrics unaffected");

  for (const value of ALL_POST_REPAIR_UNDERSTANDING) {
    resetApiState();
    seedVerification();
    await callUnderstanding(validPayload({ postRepairUnderstanding: value }));

    assert(apiState.sm2Calls.length === 0, `9a: "${value}" — no SM-2 engine function called`);
    assert(apiState.masteryCalls.length === 0, `9b: "${value}" — no concept_mastery read or write`);
    assert(apiState.logged.length === 1, `9c: "${value}" — the write went to revision_events only`);

    const rowKeys = Object.keys(apiState.logged[0] as Record<string, unknown>);
    for (const k of ["easeFactor", "intervalDays", "repetitionCount", "nextReviewAt", "lastReviewedAt", "masteryLevel"]) {
      assert(!rowKeys.includes(k), `9d: "${value}" — inserted row carries no SM-2 column "${k}"`);
    }
  }

  // Legacy R2 features are derived from MCQ accuracy. The new event is null on
  // both accuracy columns, so any consumer counting MCQ outcomes sees no change.
  resetApiState();
  seedVerification();
  await callUnderstanding(validPayload());

  const mcqHistory: RevisionEventRecord[] = [
    {
      id: "m1", userId: "user-1", conceptId: CONCEPT_ID, eventType: "mcq_attempt",
      qualityRating: 4, mcqCorrect: true, mcqQuestionIndex: 0,
      eventMetadata: { confidence: 3 }, createdAt: new Date("2026-08-01T10:00:00.000Z"),
    },
    {
      id: "m2", userId: "user-1", conceptId: CONCEPT_ID, eventType: "mcq_attempt",
      qualityRating: 1, mcqCorrect: false, mcqQuestionIndex: 1,
      eventMetadata: { failureReason: "concept_not_understood" }, createdAt: new Date("2026-08-02T10:00:00.000Z"),
    },
  ];

  const loggedRow = apiState.logged[0] as Record<string, unknown>;
  const newEventRecord: RevisionEventRecord = {
    id: "u1",
    userId: loggedRow.userId as string,
    conceptId: loggedRow.conceptId as string,
    eventType: loggedRow.eventType as string,
    qualityRating: loggedRow.qualityRating as null,
    mcqCorrect: loggedRow.mcqCorrect as null,
    mcqQuestionIndex: loggedRow.mcqQuestionIndex as null,
    eventMetadata: loggedRow.eventMetadata as Record<string, unknown>,
    createdAt: REPORTED_AT,
  };

  /** The shape every accuracy metric is computed from: attempts with a verdict. */
  const accuracyOf = (records: RevisionEventRecord[]) => {
    const scored = records.map(normalizeEvent).filter((e) => e.mcqCorrect !== null);
    const correct = scored.filter((e) => e.mcqCorrect === true).length;
    return { attempts: scored.length, correct };
  };

  const before = accuracyOf(mcqHistory);
  const after = accuracyOf([...mcqHistory, newEventRecord]);

  assert(before.attempts === 2 && before.correct === 1, "9e: baseline accuracy is 1/2");
  assert(after.attempts === before.attempts, "9f: the new event adds no scored attempt");
  assert(after.correct === before.correct, "9g: the new event adds no correct count");

  const qualityOf = (records: RevisionEventRecord[]) =>
    records.map(normalizeEvent).filter((e) => e.qualityRating !== null).length;
  assert(
    qualityOf([...mcqHistory, newEventRecord]) === qualityOf(mcqHistory),
    "9h: the new event contributes no quality rating to any average",
  );

  // And it is not miscounted as any pre-existing evidence type.
  const norm = normalizeEvent(newEventRecord);
  for (const t of ["mcq_attempt", "self_assessment", "skip", "review", "self_report", "repair_verification"]) {
    assert(norm.eventType !== t, `9i: the new event is not counted as "${t}"`);
  }

  console.log("  ✓ SM-2, concept mastery and R2 accuracy are untouched");
}

// ─── Summary ────────────────────────────────────────────────

async function main(): Promise<void> {
  await section7();
  await section8();
  await section9();

  section("RESULTS");

  console.log(`\n  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);

  if (failures.length > 0) {
    console.log(`\n  Failures:`);
    failures.forEach((f) => console.log(`    - ${f}`));
  }

  console.log(`\n  ${failed === 0 ? "✅ R3.3 POST-REPAIR UNDERSTANDING: VALIDATED" : "❌ R3.3 POST-REPAIR UNDERSTANDING: ISSUES FOUND"}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Unexpected test harness error:", err);
  process.exit(1);
});
