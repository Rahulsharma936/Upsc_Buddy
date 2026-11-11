/**
 * Reinforcement Engine Validation
 *
 * Deterministic tests for the retrieval-ordering engine that decides which
 * EXISTING Knowledge to resurface after a miss.
 *
 * Tests:
 *   Section 1: History summary reads repair events (first consumer of them)
 *   Section 2: Transfer MCQ selection — unseen first, excluded never, fallback
 *   Section 3: Ordering by failureReason
 *   Section 4: Ordering adjusted by outcome and history
 *   Section 5: Totality, determinism, cap
 *   Section 6: Isolation — no SM-2, no legacy R2, no AI, no persistence
 *
 * No database, no AI, no network, no route. Pure functions only.
 *
 * Run: npx tsx src/lib/reinforcement/__tests__/reinforcement-engine.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  summarizeHistory,
  pickTransferMcq,
  normalizeMcq,
  orderSections,
  MAX_SECTIONS,
  ALL_REINFORCEMENT_OUTCOMES,
} from "@/lib/reinforcement/reinforcement.engine";
import type {
  ReinforcementEvent,
  ReinforcementSection,
} from "@/lib/reinforcement/reinforcement.engine";
import { ALL_FAILURE_REASONS } from "@/lib/repair/repair-request.builder";

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

function ev(
  eventType: string,
  eventMetadata: Record<string, unknown> = {},
  mcqQuestionIndex: number | null = null,
): ReinforcementEvent {
  return { eventType, eventMetadata, mcqQuestionIndex };
}

const mcq = (i: number, questionId: string | null = `q${i}`) => ({
  questionId: questionId ?? undefined,
  question: `Question ${i}?`,
  options: { a: "A", b: "B", c: "C", d: "D" },
  correctAnswer: "b",
  explanation: `Because ${i}`,
  difficulty: "moderate",
});

const NO_HISTORY = { lastVerificationCorrect: null, lastUnderstanding: null };

// ─── Section 1: History ─────────────────────────────────────

section("Section 1: History summary consumes repair events");
{
  const h = summarizeHistory([
    ev("mcq_attempt", { mcqCorrect: true, questionId: "q0" }, 0),
    ev("mcq_attempt", { mcqCorrect: false, questionId: "q1" }, 1),
    ev("repair_verification", { verificationCorrect: false }),
    ev("repair_understanding", { postRepairUnderstanding: "somewhat_unsure" }),
    ev("repair_verification", { verificationCorrect: true }),
    ev("repair_understanding", { postRepairUnderstanding: "understood" }),
    ev("self_assessment", { selfAssessment: "forgot" }),
  ]);

  assert(h.mcqAttempts === 2, "1a: counts MCQ attempts");
  assert(h.mcqCorrect === 1, "1b: counts correct MCQs");
  assert(h.attemptedQuestionIds.has("q0") && h.attemptedQuestionIds.has("q1"), "1c: collects attempted questionIds");
  assert(h.attemptedQuestionIndexes.has(0) && h.attemptedQuestionIndexes.has(1), "1d: collects attempted indexes");
  assert(h.repairCount === 2, "1e: counts repair verifications");
  assert(h.lastVerificationCorrect === true, "1f: last verification wins (chronological)");
  assert(h.lastUnderstanding === "understood", "1g: last understanding wins (chronological)");

  const empty = summarizeHistory([]);
  assert(empty.repairCount === 0 && empty.lastVerificationCorrect === null && empty.lastUnderstanding === null, "1h: empty history → nulls and zeros");

  const legacy = summarizeHistory([ev("mcq_attempt", { mcqCorrect: false }, 3)]);
  assert(legacy.attemptedQuestionIds.size === 0 && legacy.attemptedQuestionIndexes.has(3), "1i: legacy events without questionId fall back to index");

  const garbage = summarizeHistory([{ eventType: "mcq_attempt", eventMetadata: null, mcqQuestionIndex: null }]);
  assert(garbage.mcqAttempts === 1 && garbage.mcqCorrect === 0, "1j: null metadata does not throw");
}

// ─── Section 2: Transfer MCQ ─────────────────────────────────

section("Section 2: Transfer MCQ selection");
{
  const inventory = [mcq(0), mcq(1), mcq(2)];
  const fresh = { attemptedQuestionIds: new Set<string>(), attemptedQuestionIndexes: new Set<number>() };

  const first = pickTransferMcq(inventory, fresh);
  assert(first?.questionId === "q0", "2a: no history → first valid question");

  const excluded = pickTransferMcq(inventory, fresh, { questionId: "q0" });
  assert(excluded?.questionId === "q1", "2b: the question just missed is never returned");

  const seen = { attemptedQuestionIds: new Set(["q0", "q1"]), attemptedQuestionIndexes: new Set<number>() };
  const unseen = pickTransferMcq(inventory, seen, { questionId: "q0" });
  assert(unseen?.questionId === "q2", "2c: unseen question preferred over attempted ones");

  const allSeen = { attemptedQuestionIds: new Set(["q0", "q1", "q2"]), attemptedQuestionIndexes: new Set<number>() };
  const fallback = pickTransferMcq(inventory, allSeen, { questionId: "q0" });
  assert(fallback?.questionId === "q1", "2d: all seen → falls back to first non-excluded");

  const legacyInv = [mcq(0, null), mcq(1, null)];
  const byIndex = pickTransferMcq(legacyInv, { attemptedQuestionIds: new Set(), attemptedQuestionIndexes: new Set([0]) }, { questionIndex: 0 });
  assert(byIndex?.questionIndex === 1, "2e: legacy MCQs without ids use index for exclusion and seen-ness");

  assert(pickTransferMcq([], fresh) === null, "2f: empty inventory → null");
  assert(pickTransferMcq([mcq(0)], fresh, { questionId: "q0" }) === null, "2g: only the excluded question → null");

  assert(normalizeMcq({ question: "x", options: { a: "1", b: "2", c: "3" }, correctAnswer: "a" }, 0) === null, "2h: malformed MCQ (missing option) rejected");
  assert(normalizeMcq({ question: "x", options: { a: "1", b: "2", c: "3", d: "4" }, correctAnswer: "e" }, 0) === null, "2i: malformed MCQ (bad answer key) rejected");
  assert(normalizeMcq("nope", 0) === null, "2j: non-object rejected");
  const ok = normalizeMcq(mcq(5), 5);
  assert(ok?.questionIndex === 5 && ok.correctAnswer === "b" && ok.explanation === "Because 5", "2k: well-formed MCQ normalized with index");

  const mixed = pickTransferMcq(["junk", mcq(1)], fresh);
  assert(mixed?.questionId === "q1", "2l: malformed entries skipped, valid ones still picked");
}

// ─── Section 3: Ordering by reason ───────────────────────────

section("Section 3: Ordering by failureReason");
{
  const order = (r: Parameters<typeof orderSections>[0]["failureReason"]) =>
    orderSections({ failureReason: r, outcome: "leave_for_revision", history: NO_HISTORY });

  assert(order("could_not_recall")[0] === "hooks", "3a: could_not_recall leads with memory hooks");
  assert(!order("could_not_recall").includes("coreIdea"), "3b: could_not_recall does not re-teach the core idea");
  assert(order("concept_not_understood")[0] === "coreIdea", "3c: concept_not_understood leads with the core idea");
  assert(order("concept_not_understood").includes("dominoes"), "3d: concept_not_understood links prerequisite dominoes");
  assert(order("misunderstood_question")[0] === "transferMcq", "3e: misunderstood_question leads with a transfer question");
  assert(order("careless_mistake")[0] === "transferMcq", "3f: careless_mistake leads with a transfer question");
  assert(order("guessed")[0] === "coreIdea" && order("guessed")[1] === "transferMcq", "3g: guessed → core idea then verify by question");
  assert(order("overconfident").includes("pyqs"), "3h: overconfident sees how UPSC actually asked it");
  assert(order("not_sure")[0] === "coreIdea", "3i: not_sure leads with the core idea");
  assert(order(null)[0] === "transferMcq" && !order(null).includes("coreIdea"), "3j: no reason → practice, no re-teaching");

  for (const r of ALL_FAILURE_REASONS) {
    const o = order(r);
    assert(o.length > 0 && o.length <= MAX_SECTIONS, `3k: ${r} returns 1..${MAX_SECTIONS} sections`);
    assert(new Set(o).size === o.length, `3l: ${r} has no duplicate sections`);
  }
}

// ─── Section 4: Outcome and history adjustments ──────────────

section("Section 4: Outcome and history adjustments");
{
  const complete = orderSections({ failureReason: "concept_not_understood", outcome: "repair_complete", history: NO_HISTORY });
  assert(!complete.includes("coreIdea"), "4a: repair_complete drops the core idea they just demonstrated");
  assert(complete[0] === "transferMcq", "4b: repair_complete leads with a transfer question");

  const another = orderSections({ failureReason: "could_not_recall", outcome: "offer_another_repair", history: NO_HISTORY });
  assert(another[0] === "coreIdea", "4c: offer_another_repair pulls the core idea to the front");

  const failedVerify = orderSections({ failureReason: "could_not_recall", outcome: "leave_for_revision", history: { lastVerificationCorrect: false, lastUnderstanding: null } });
  assert(failedVerify[0] === "coreIdea", "4d: a failed last verification pulls the core idea to the front");

  const stillNot = orderSections({ failureReason: "misunderstood_question", outcome: "leave_for_revision", history: { lastVerificationCorrect: true, lastUnderstanding: "still_not_understood" } });
  assert(stillNot[0] === "coreIdea", "4e: 'still_not_understood' pulls the core idea to the front");

  const completeButStruggled = orderSections({ failureReason: "could_not_recall", outcome: "repair_complete", history: { lastVerificationCorrect: false, lastUnderstanding: null } });
  assert(!completeButStruggled.includes("coreIdea"), "4f: repair_complete still wins over stale struggle history");

  const clarified = orderSections({ failureReason: "not_sure", outcome: "clarified", history: NO_HISTORY });
  assert(clarified.includes("staticCurrent") || clarified.length === MAX_SECTIONS, "4g: clarified appends static↔current link when room allows");

  const leave = orderSections({ failureReason: "careless_mistake", outcome: "leave_for_revision", history: NO_HISTORY });
  assert(leave.includes("staticCurrent"), "4h: leave_for_revision appends static↔current link");
}

// ─── Section 5: Totality, determinism, cap ───────────────────

section("Section 5: Totality, determinism, cap");
{
  const VALID: ReinforcementSection[] = ["coreIdea", "hooks", "triggers", "staticCurrent", "transferMcq", "pyqs", "dominoes", "mainsAngle"];
  const reasons = [...ALL_FAILURE_REASONS, null] as const;
  const histories = [
    NO_HISTORY,
    { lastVerificationCorrect: false, lastUnderstanding: null },
    { lastVerificationCorrect: true, lastUnderstanding: "still_not_understood" },
  ];

  let combos = 0;
  for (const r of reasons) {
    for (const o of ALL_REINFORCEMENT_OUTCOMES) {
      for (const h of histories) {
        const a = orderSections({ failureReason: r, outcome: o, history: h });
        const b = orderSections({ failureReason: r, outcome: o, history: h });
        combos++;
        assert(a.length >= 1 && a.length <= MAX_SECTIONS, `5a: ${r}/${o} within cap`);
        assert(JSON.stringify(a) === JSON.stringify(b), `5b: ${r}/${o} deterministic`);
        assert(a.every((s) => VALID.includes(s)), `5c: ${r}/${o} only known sections`);
      }
    }
  }
  assert(combos === reasons.length * ALL_REINFORCEMENT_OUTCOMES.length * histories.length, "5d: every combination exercised");
  console.log(`  ✓ ${combos} reason × outcome × history combinations are total and deterministic`);
}

// ─── Section 6: Isolation ────────────────────────────────────

section("Section 6: Isolation — no SM-2, no legacy R2, no AI, no persistence");
{
  const source = readFileSync(
    join(process.cwd(), "src/lib/reinforcement/reinforcement.engine.ts"),
    "utf8",
  );
  const forbidden = [
    "lib/diagnostic", "spaced-repetition", "revision-intelligence",
    "@/lib/ai/client", "@/lib/db", "repositories", "drizzle", "fetch(",
  ];
  for (const token of forbidden) {
    assert(!source.includes(token), `6a: engine does not reference "${token}"`);
  }
  const importLines = source.split("\n").filter((l) => /^\s*import\b/.test(l));
  assert(importLines.length === 1 && importLines[0].startsWith("import type "), "6b: single type-only import — no runtime dependency");

  const service = readFileSync(
    join(process.cwd(), "src/lib/reinforcement/reinforcement.service.ts"),
    "utf8",
  );
  for (const token of ["lib/diagnostic", "spaced-repetition", "revision-intelligence", "@/lib/ai/client", "upsertMastery", "recordReview", "logEvent("]) {
    assert(!service.includes(token), `6c: service does not reference "${token}"`);
  }
  console.log("  ✓ Retrieval only: no generation, no scheduling, no writes");
}

// ─── Summary ────────────────────────────────────────────────

section("RESULTS");

console.log(`\n  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);

if (failures.length > 0) {
  console.log(`\n  Failures:`);
  failures.forEach((f) => console.log(`    - ${f}`));
}

console.log(`\n  ${failed === 0 ? "✅ REINFORCEMENT ENGINE: VALIDATED" : "❌ REINFORCEMENT ENGINE: ISSUES FOUND"}\n`);

process.exit(failed > 0 ? 1 : 0);
