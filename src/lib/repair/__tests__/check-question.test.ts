/**
 * Check-question selection — pure.
 *
 * Run: npx tsx src/lib/repair/__tests__/check-question.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  similarity,
  isNearDuplicate,
  checkProblem,
  chooseCheckQuestion,
  rankByTermOverlap,
  type CheckCandidate,
  type CheckContext,
} from "@/lib/repair/check-question";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string): void {
  if (c) passed++;
  else { failed++; failures.push(label); console.error(`  ✗ FAIL: ${label}`); }
}

// The exact case the user reported.
const recallPrompt = "Which constitutional amendment introduced reservation for Scheduled Castes and Scheduled Tribes in Panchayat elections?";
const shown = `${recallPrompt} Cue: Recall the amendment that dealt with reservation, not protection. The 73rd Constitutional Amendment Act, 1992 introduced reservation for SCs and STs in Panchayat seats, including the chairperson post. The 17th Amendment dealt with protection by placing Panchayat institutions in the Ninth Schedule.`;
const ctx: CheckContext = { shownText: shown, avoidQuestions: [recallPrompt], missedQuestionId: "missed-1", missedQuestionText: "Q about Panchayati Raj" };

const repeated = { questionId: null, question: recallPrompt, options: { a: "73rd Constitutional Amendment", b: "74th Constitutional Amendment", c: "42nd Constitutional Amendment", d: "17th Constitutional Amendment" }, correctAnswer: "a" as const, explanation: "" };

// 1. Similarity
assert(similarity(recallPrompt, recallPrompt) === 1, "1a: identical → 1");
assert(isNearDuplicate(recallPrompt, "Which amendment introduced reservation for Scheduled Castes and Scheduled Tribes in Panchayats?"), "1b: close paraphrase is a near-duplicate");
assert(!isNearDuplicate(recallPrompt, "Consider the following statements about the Ninth Schedule and judicial review."), "1c: different topic is not");

// 2. Problems
assert(checkProblem(repeated, ctx) === "repeats the recall prompt or the missed question", "2a: the reported repeat is rejected");
assert(checkProblem({ ...repeated, question: "Consider the following statements about State Election Commissions...", questionId: "missed-1" }, ctx) === "is the question just missed", "2b: the missed question is rejected by id");
const fresh = { questionId: "q9", question: "Consider the following statements: 1. The State Election Commission conducts Panchayat elections. 2. Article 243K vests it in the Governor's discretion. How many are correct?", options: { a: "Only one", b: "Only two", c: "Both", d: "None" }, correctAnswer: "a" as const, explanation: "" };
assert(checkProblem(fresh, ctx) === null, "2c: an adjacent, statement-format question passes");

// 3. Choice order: bank unseen > bank seen > related unseen > related seen; dirty ones skipped
const mk = (id: string, kind: "bank" | "related", seen: boolean, question = `Consider the following statements on topic ${id}: 1. alpha ${id}. 2. beta ${id}. How many are correct?`): CheckCandidate => ({
  mcq: { questionId: id, question, options: { a: "Only one", b: "Only two", c: "Both", d: "None" }, correctAnswer: "b", explanation: "" },
  source: kind === "bank" ? { kind } : { kind, conceptName: "Rel" },
  seen,
});
assert(chooseCheckQuestion([mk("r1", "related", false), mk("b1", "bank", true), mk("b2", "bank", false)], ctx)?.mcq.questionId === "b2", "3a: unseen bank question first");
assert(chooseCheckQuestion([mk("r1", "related", false), mk("b1", "bank", true)], ctx)?.mcq.questionId === "b1", "3b: seen bank before related");
assert(chooseCheckQuestion([mk("r1", "related", true), mk("r2", "related", false)], ctx)?.mcq.questionId === "r2", "3c: unseen related before seen related");
assert(chooseCheckQuestion([mk("missed-1", "bank", false), { ...mk("rep", "bank", false), mcq: { ...repeated, questionId: "rep" } }], ctx) === null, "3d: only dirty candidates → null (fall back to generated)");
assert(chooseCheckQuestion([], ctx) === null, "3e: no candidates → null");

// 4. Related concepts by terms the repair discussed
const concepts = [
  { id: "self", displayName: "Panchayati Raj (Local Self-Government", keywords: ["73rd Amendment"] },
  { id: "c-ninth", displayName: "Ninth Schedule", keywords: ["judicial review", "land reforms"] },
  { id: "c-res", displayName: "Reservation Policy", keywords: ["Scheduled Castes", "Scheduled Tribes", "Article 16(4)"] },
  { id: "c-geo", displayName: "Monsoon", keywords: ["ITCZ"] },
];
const ranked = rankByTermOverlap(shown, concepts, "self");
assert(ranked.map((c) => c.id).join(",") === "c-res,c-ninth", "4a: reservation (2 hits) then Ninth Schedule (1 hit); self and unrelated excluded");

// 5. Wiring
const route = readFileSync(join(process.cwd(), "src/app/api/repair/route.ts"), "utf8");
assert(route.includes("chooseCheckQuestion") && route.includes("BANK_FIRST_INTENTS"), "5a: route chooses bank/related check questions for content intents");
assert(route.includes("auditMcqKeys([v])"), "5b: generated check questions have their key audited");
const svc = readFileSync(join(process.cwd(), "src/lib/repair/check-question.service.ts"), "utf8");
assert(svc.includes("meta.audited !== true"), "5c: only audited inventories are used");

console.log(`\n  Passed: ${passed}\n  Failed: ${failed}`);
if (failures.length) { console.log("\n  Failures:"); failures.forEach((f) => console.log(`    - ${f}`)); }
console.log(`\n  ${failed === 0 ? "✅ CHECK QUESTION: VALIDATED" : "❌ CHECK QUESTION: ISSUES FOUND"}\n`);
process.exit(failed > 0 ? 1 : 0);
