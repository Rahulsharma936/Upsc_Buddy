/**
 * Verification standard + leak guard.
 *
 * Tests:
 *   Section 1: Leak detection on the real failure case (Chhattisgarh)
 *   Section 2: Non-leaks (statement-count options, distractor also shown)
 *   Section 3: collectShownText excludes the verification and identifiers
 *   Section 4: Guidance block (standard always present, note, avoidAnswers)
 *   Section 5: Every executor injects the guidance; route regenerates on leak
 *
 * Run: npx tsx src/lib/repair/__tests__/verification-standard.test.ts
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { findVerificationLeak, collectShownText, normalizeForLeak } from "@/lib/repair/verification-leak";
import { formatRepairGuidance, VERIFICATION_STANDARD } from "@/lib/repair/note-grounding";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string): void {
  if (c) passed++;
  else { failed++; failures.push(label); console.error(`  ✗ FAIL: ${label}`); }
}
function section(t: string): void { console.log(`\n── ${t} ${"─".repeat(Math.max(0, 55 - t.length))}`); }

// The exact giveaway the user reported.
const chhattisgarhRepair = {
  requestId: "r1",
  conceptId: "c1",
  failureReason: "could_not_recall",
  repairIntent: "active_recall",
  retrieval: { prompt: "Which state has deposits of both iron ore and coal?", cue: null },
  reveal: { expectedAnswer: "Chhattisgarh has significant deposits of both iron ore and coal.", feedback: "…" },
  verification: {
    question: "Which of the following states is a major producer of both iron ore and coal?",
    options: { a: "Odisha", b: "Chhattisgarh", c: "Rajasthan", d: "Gujarat" },
    correctAnswer: "b",
    explanation: "Chhattisgarh is rich in both.",
  },
  status: "ready",
};

section("Section 1: The reported giveaway is caught");
{
  const shown = collectShownText(chhattisgarhRepair);
  assert(findVerificationLeak(shown, chhattisgarhRepair.verification) === "Chhattisgarh", "1a: answer stated in the reveal, no distractor stated → leak");
  assert(normalizeForLeak("Chhattisgarh's") === "chhattisgarh s", "1b: normaliser strips punctuation");
}

section("Section 2: Legitimate questions are not flagged");
{
  const statementCount = { options: { a: "Only one", b: "Only two", c: "All three", d: "None" }, correctAnswer: "b" };
  assert(findVerificationLeak("Only two of these hold. Article 21 covers life.", statementCount) === null, "2a: 'Only two' is a format option — never a leak");
  const pairs = { options: { a: "1 and 2 only", b: "2 and 3 only", c: "1 and 3 only", d: "1, 2 and 3" }, correctAnswer: "c" };
  assert(findVerificationLeak("Statements 1 and 3 only are correct.", pairs) === null, "2a2: statement-number combos are format options");
  const fair = { options: { a: "Odisha", b: "Chhattisgarh", c: "Jharkhand", d: "Goa" }, correctAnswer: "b" };
  assert(findVerificationLeak("Odisha and Chhattisgarh both mine iron ore; Jharkhand leads in coal.", fair) === null, "2b: distractors also discussed → requires reasoning, not a leak");
  const notShown = { options: { a: "Article 14", b: "Article 32", c: "Article 226", d: "Article 13" }, correctAnswer: "d" };
  assert(findVerificationLeak("Judicial review lets courts strike down laws.", notShown) === null, "2c: answer not in shown text → no leak");
  assert(findVerificationLeak("anything", null) === null, "2d: no verification (clarification) → no leak");
  const partialWord = { options: { a: "Indus", b: "Ganga", c: "Narmada", d: "Godavari" }, correctAnswer: "a" };
  assert(findVerificationLeak("Industrial corridors along the coast.", partialWord) === null, "2e: substring of a longer word does not count (word boundaries)");
}

section("Section 3: Shown text");
{
  const shown = collectShownText(chhattisgarhRepair);
  assert(!shown.includes("Odisha") && !shown.includes("major producer"), "3a: verification excluded");
  assert(!shown.includes("could_not_recall") && !shown.includes("active_recall") && !shown.includes("r1"), "3b: identifiers and enums excluded");
  assert(shown.includes("iron ore and coal"), "3c: retrieval and reveal included");
}

section("Section 4: Guidance block");
{
  const none = formatRepairGuidance(null);
  assert(none.includes("VERIFICATION QUESTION STANDARD") && none === VERIFICATION_STANDARD, "4a: standard emitted even without a note");
  assert(none.includes("How many of the above statements are correct") && none.includes("must NOT be answerable"), "4b: standard names UPSC formats and bans giveaways");
  const withNote = formatRepairGuidance({ coreIdea: "Courts test laws against the Constitution", memoryHooks: ["Art 13 = shield"], examTriggers: ["Art 32"] });
  assert(withNote.includes("STUDENT'S EXISTING NOTE") && withNote.includes("Art 13 = shield"), "4c: note grounding appended");
  const avoid = formatRepairGuidance({ coreIdea: "", memoryHooks: [], examTriggers: [], avoidAnswers: ["Chhattisgarh"] });
  assert(avoid.includes("PREVIOUS ATTEMPT REJECTED") && avoid.includes('"Chhattisgarh"'), "4d: banned answer named on retry");
}

section("Section 5: Wiring");
{
  const dir = join(process.cwd(), "src/lib/repair");
  const executors = readdirSync(dir).filter((f) => f.endsWith(".executor.ts"));
  assert(executors.length === 7, "5a: seven executors present");
  for (const f of executors) {
    const src = readFileSync(join(dir, f), "utf8");
    if (f === "clarification.executor.ts") {
      // Clarification asks no verification question, so it gets the note only.
      assert(src.includes("${formatNoteGrounding(conceptNote)}") && !src.includes("formatRepairGuidance"), "5b: clarification gets note grounding without the verification standard");
    } else {
      assert(src.includes("${formatRepairGuidance(conceptNote)}"), `5b: ${f} injects the guidance block`);
    }
  }
  const route = readFileSync(join(process.cwd(), "src/app/api/repair/route.ts"), "utf8");
  assert(route.includes("checkProblem(") && route.includes("avoidAnswers:") && route.includes("avoidQuestions:"), "5c: route rejects a leaky or repeated check question and regenerates once with the answer and question banned");
  const grounding = readFileSync(join(dir, "note-grounding.ts"), "utf8");
  assert(!/^\s*import\s/m.test(grounding), "5d: note-grounding stays import-free");
}

section("RESULTS");
console.log(`\n  Passed: ${passed}\n  Failed: ${failed}`);
if (failures.length) { console.log("\n  Failures:"); failures.forEach((f) => console.log(`    - ${f}`)); }
console.log(`\n  ${failed === 0 ? "✅ VERIFICATION STANDARD: VALIDATED" : "❌ VERIFICATION STANDARD: ISSUES FOUND"}\n`);
process.exit(failed > 0 ? 1 : 0);
