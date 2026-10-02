/**
 * R3.4 — Repair Next Action Validation
 *
 * Deterministic tests for the decision that closes the repair loop.
 *
 * Tests:
 *   Section 1: The full decision matrix (3 reports × 2 verification outcomes)
 *   Section 2: Abandoned self-report
 *   Section 3: Totality, determinism and purity
 *   Section 4: The two governing invariants
 *   Section 5: The one-re-offer-per-question-per-session guard
 *   Section 6: Isolation — no SM-2, no legacy R2, no persistence
 *
 * No database, no AI, no network, no route. This is a pure function.
 *
 * Nothing here asserts a MEANING for any combination. The tests prove which
 * ACTION each combination produces, and that the two principles the rules
 * encode cannot be silently broken by a later edit.
 *
 * Run: npx tsx src/lib/repair/__tests__/repair-next-action.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decideNextAction,
  applyReofferLimit,
  MAX_ADDITIONAL_REPAIR_OFFERS,
} from "@/lib/repair/repair-next-action";
import type {
  RepairNextAction,
  RepairOutcomeEvidence,
} from "@/lib/repair/repair-next-action";
import { ALL_POST_REPAIR_UNDERSTANDING } from "@/lib/repair/repair-understanding";
import type { PostRepairUnderstanding } from "@/lib/evidence/evidence.types";

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

const ALL_ACTIONS: RepairNextAction[] = [
  "repair_complete",
  "offer_another_repair",
  "leave_for_revision",
];

/** Every input the function can ever receive: 3 reports + absent, × 2 outcomes. */
const ALL_REPORTS: (PostRepairUnderstanding | null)[] = [
  ...ALL_POST_REPAIR_UNDERSTANDING,
  null,
];

function evidence(
  verificationCorrect: boolean,
  postRepairUnderstanding: PostRepairUnderstanding | null,
): RepairOutcomeEvidence {
  return { verificationCorrect, postRepairUnderstanding };
}

// ─── 1. The decision matrix ─────────────────────────────────

section("1. Decision matrix (3 reports × 2 verification outcomes)");
{
  // Both signals agree, positively.
  assert(
    decideNextAction(evidence(true, "understood")) === "repair_complete",
    "1a: correct + understood → repair_complete",
  );

  // The student did not claim to be settled, so nothing claims it for them.
  assert(
    decideNextAction(evidence(true, "somewhat_unsure")) === "leave_for_revision",
    "1b: correct + somewhat_unsure → leave_for_revision",
  );

  // The student asked for more help. A correct answer does not overrule that.
  assert(
    decideNextAction(evidence(true, "still_not_understood")) === "offer_another_repair",
    "1c: correct + still_not_understood → offer_another_repair",
  );

  // Conflicting evidence, preserved: not a success, not a diagnosis.
  assert(
    decideNextAction(evidence(false, "understood")) === "leave_for_revision",
    "1d: incorrect + understood → leave_for_revision",
  );

  assert(
    decideNextAction(evidence(false, "somewhat_unsure")) === "leave_for_revision",
    "1e: incorrect + somewhat_unsure → leave_for_revision",
  );

  // Both signals agree, negatively.
  assert(
    decideNextAction(evidence(false, "still_not_understood")) === "offer_another_repair",
    "1f: incorrect + still_not_understood → offer_another_repair",
  );

  console.log("  ✓ All six combinations map to their specified action");
}

// ─── 2. Abandoned self-report ───────────────────────────────

section("2. Abandoned self-report");
{
  assert(
    decideNextAction(evidence(true, null)) === "leave_for_revision",
    "2a: correct + no report → leave_for_revision",
  );
  assert(
    decideNextAction(evidence(false, null)) === "leave_for_revision",
    "2b: incorrect + no report → leave_for_revision",
  );
  assert(
    decideNextAction(evidence(true, null)) === decideNextAction(evidence(false, null)),
    "2c: with no report, the verification outcome changes nothing",
  );

  console.log("  ✓ A missing report claims nothing either way");
}

// ─── 3. Totality, determinism, purity ───────────────────────

section("3. Totality, determinism and purity");
{
  let covered = 0;
  for (const correct of [true, false]) {
    for (const report of ALL_REPORTS) {
      const action = decideNextAction(evidence(correct, report));
      assert(
        ALL_ACTIONS.includes(action),
        `3a: (${correct}, ${report ?? "null"}) returns a valid action`,
      );
      covered++;
    }
  }
  assert(covered === 8, "3b: all eight possible inputs exercised");

  // Determinism: same input, same answer, every time.
  const input = evidence(true, "understood");
  assert(
    decideNextAction(input) === decideNextAction(input),
    "3c: repeated calls return the same action",
  );

  // Purity: the input object is never mutated.
  const snapshot = JSON.stringify(input);
  decideNextAction(input);
  assert(JSON.stringify(input) === snapshot, "3d: the input evidence is not mutated");

  // The return is a bare enum — no object, no reason string, no score.
  assert(typeof decideNextAction(input) === "string", "3e: returns a bare string enum");

  console.log("  ✓ Total over all inputs, deterministic, side-effect free");
}

// ─── 4. Governing invariants ────────────────────────────────

section("4. Governing invariants");
{
  // Invariant 1: the student's request for help is never overridden.
  for (const correct of [true, false]) {
    assert(
      decideNextAction(evidence(correct, "still_not_understood")) === "offer_another_repair",
      `4a: still_not_understood always offers another repair (verification=${correct})`,
    );
  }

  // Invariant 2: completion is only ever reached when BOTH signals agree.
  let completions = 0;
  for (const correct of [true, false]) {
    for (const report of ALL_REPORTS) {
      if (decideNextAction(evidence(correct, report)) === "repair_complete") {
        completions++;
        assert(correct === true, "4b: repair_complete requires a correct verification");
        assert(report === "understood", "4c: repair_complete requires the student to say so");
      }
    }
  }
  assert(completions === 1, "4d: exactly one of the eight inputs reaches repair_complete");

  // The verification result can neither manufacture nor veto an outcome on
  // its own: flipping it alone changes the action in exactly one case.
  let flipsThatMatter = 0;
  for (const report of ALL_REPORTS) {
    if (
      decideNextAction(evidence(true, report)) !== decideNextAction(evidence(false, report))
    ) {
      flipsThatMatter++;
      assert(report === "understood", "4e: verification only matters when the student says understood");
    }
  }
  assert(flipsThatMatter === 1, "4f: verification changes the action in exactly one of four reports");

  console.log("  ✓ Student report leads; verification may only confirm");
}

// ─── 5. Re-offer guard ──────────────────────────────────────

section("5. One-re-offer-per-question-per-session guard");
{
  assert(MAX_ADDITIONAL_REPAIR_OFFERS === 1, "5a: exactly one extra repair is budgeted");

  const offer: RepairNextAction = "offer_another_repair";

  // First time through: the offer stands.
  assert(applyReofferLimit(offer, 0) === "offer_another_repair", "5b: 0 used → offer stands");

  // The budget is spent: fall back rather than looping.
  assert(applyReofferLimit(offer, 1) === "leave_for_revision", "5c: 1 used → falls back");
  assert(applyReofferLimit(offer, 2) === "leave_for_revision", "5d: over budget → falls back");

  // The guard only ever downgrades an offer; it never invents or upgrades one.
  for (const used of [0, 1, 2]) {
    assert(
      applyReofferLimit("repair_complete", used) === "repair_complete",
      `5e: repair_complete passes through untouched (used=${used})`,
    );
    assert(
      applyReofferLimit("leave_for_revision", used) === "leave_for_revision",
      `5f: leave_for_revision passes through untouched (used=${used})`,
    );
  }

  // Idempotent: applying the guard to its own output changes nothing.
  const once = applyReofferLimit(offer, 1);
  assert(applyReofferLimit(once, 1) === once, "5g: guard is idempotent");

  // End-to-end: the same evidence that offers a repair the first time is left
  // for revision the second time, without the decision rules changing.
  const stillStuck = evidence(false, "still_not_understood");
  assert(
    applyReofferLimit(decideNextAction(stillStuck), 0) === "offer_another_repair",
    "5h: first pass through the loop offers the extra repair",
  );
  assert(
    applyReofferLimit(decideNextAction(stillStuck), 1) === "leave_for_revision",
    "5i: second pass with the budget spent leaves it for revision",
  );
  assert(
    decideNextAction(stillStuck) === "offer_another_repair",
    "5j: the underlying decision rules are unchanged by the guard",
  );

  console.log("  ✓ At most one extra repair per question; the loop terminates");
}

// ─── 6. Isolation ───────────────────────────────────────────

section("6. Isolation — no SM-2, no legacy R2, no persistence");
{
  const source = readFileSync(
    join(process.cwd(), "src/lib/repair/repair-next-action.ts"),
    "utf-8",
  );

  // Strip comments: the module's prose says what it deliberately is NOT
  // ("NOT a score", never marked "resolved"), and those disclaimers must not
  // be mistaken for the code doing the thing they disclaim.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  const forbidden = [
    "lib/diagnostic",
    "spaced-repetition",
    "revision-intelligence",
    "revision.repository",
    "concept.repository",
    "supabase",
    "@/lib/db",
    "logEvent",
    "recordReview",
    "conceptMastery",
    "concept_gap",
    "memory_gap",
    "calibration_gap",
    "resolved",
    "score",
  ];
  for (const token of forbidden) {
    assert(!code.includes(token), `6a: module code never references "${token}"`);
  }

  // The only import is a type, so nothing is pulled in at runtime.
  const importLines = source
    .split("\n")
    .filter((l) => /^\s*import\b/.test(l));
  assert(importLines.length === 1, "6b: exactly one import statement");
  assert(
    importLines[0].startsWith("import type "),
    "6c: that import is type-only — no runtime dependency",
  );

  console.log("  ✓ Pure module: no persistence, no scheduling, no legacy R2");
}

// ─── Summary ────────────────────────────────────────────────

section("RESULTS");

console.log(`\n  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);

if (failures.length > 0) {
  console.log(`\n  Failures:`);
  failures.forEach((f) => console.log(`    - ${f}`));
}

console.log(`\n  ${failed === 0 ? "✅ R3.4 REPAIR NEXT ACTION: VALIDATED" : "❌ R3.4 REPAIR NEXT ACTION: ISSUES FOUND"}\n`);

process.exit(failed > 0 ? 1 : 0);
