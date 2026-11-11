/**
 * MCQ answer-key audit — pure parts.
 *
 * Run: npx tsx src/lib/ai/__tests__/mcq-audit.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyAudit, buildAuditPrompt, combineAudits, AUDIT_SYSTEM_PROMPT } from "@/lib/ai/services/mcq-audit";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string): void {
  if (c) passed++;
  else { failed++; failures.push(label); console.error(`  ✗ FAIL: ${label}`); }
}

const opts = { a: "Only one", b: "Only two", c: "All three", d: "None" };
const mcqs = [
  { question: "Q0 statements", options: opts, correctAnswer: "c" },
  { question: "Q1 statements", options: opts, correctAnswer: "b" },
  { question: "Q2 statements", options: opts, correctAnswer: "a" },
  { question: "Q3 statements", options: opts, correctAnswer: "d" },
  { question: "Q4 statements", options: opts, correctAnswer: "a" },
];

const prompt = buildAuditPrompt(mcqs);
assert(prompt.includes("QUESTION 0") && prompt.includes("QUESTION 4"), "1a: every question is in the audit prompt");
assert(!/correctAnswer|answer key|stated key/i.test(prompt), "1b: the stated keys are never shown to the auditor");
assert(prompt.includes("(a) Only one") && prompt.includes("(d) None"), "1c: options are listed");

const { kept, dropped } = applyAudit(mcqs, [
  { index: 0, answer: "b", flawed: false, reason: "only two true" }, // disagreement → drop
  { index: 1, answer: "b", flawed: false, reason: "agrees" },        // agree → keep
  { index: 2, answer: "a", flawed: true, reason: "factual error" },  // flawed → drop even if agrees
  { index: 3, answer: null, flawed: false, reason: "no correct option" }, // unanswerable → drop
  // index 4 missing → keep (fail-open per question)
]);
assert(kept.map((m) => m.question).join(",") === "Q1 statements,Q4 statements", "2a: only agreeing and un-audited questions survive");
assert(dropped.length === 3 && dropped[0].verdict.answer === "b", "2b: disagreement, flawed and unanswerable are dropped with their verdicts");

// Two auditors: a question survives only if both agree with the key.
const combined = combineAudits(mcqs, [
  [{ index: 0, answer: "c", flawed: false, reason: "" }, { index: 1, answer: "b", flawed: false, reason: "" }],
  [{ index: 0, answer: "d", flawed: false, reason: "second family disagrees", auditor: "qwen" }, { index: 1, answer: "b", flawed: false, reason: "" }],
]);
assert(!combined.kept.some((m) => m.question === "Q0 statements") && combined.kept.some((m) => m.question === "Q1 statements"), "2c: one auditor disagreeing is enough to drop");
assert(combined.dropped.length === 1 && combined.dropped[0].verdict.auditor === "qwen", "2d: the dropping auditor is recorded");
assert(combineAudits(mcqs, []).kept.length === mcqs.length, "2e: no auditor verdicts → nothing dropped");
assert(AUDIT_SYSTEM_PROMPT.includes("CURRENT") && AUDIT_SYSTEM_PROMPT.includes("both statements are false but no option"), "2f: audit prompt targets outdated figures and impossible option sets");

const src = readFileSync(join(process.cwd(), "src/lib/ai/services/question-intelligence.service.ts"), "utf8");
assert(src.includes("auditMcqKeys(prelims)") && src.indexOf("auditMcqKeys(prelims)") < src.indexOf("conceptQuestionsRepository.upsert"), "3a: audit runs before questions are persisted");

console.log(`\n  Passed: ${passed}\n  Failed: ${failed}`);
if (failures.length) { console.log("\n  Failures:"); failures.forEach((f) => console.log(`    - ${f}`)); }
console.log(`\n  ${failed === 0 ? "✅ MCQ AUDIT: VALIDATED" : "❌ MCQ AUDIT: ISSUES FOUND"}\n`);
process.exit(failed > 0 ? 1 : 0);
