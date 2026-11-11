/**
 * Answer evidence — Insights computed from recorded answers.
 *
 * Run: npx tsx src/lib/insights/__tests__/answer-evidence.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scoreEvent, buildAnswerEvidence, type EvidenceEvent } from "@/lib/insights/answer-evidence";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string): void {
  if (c) passed++;
  else { failed++; failures.push(label); console.error(`  ✗ FAIL: ${label}`); }
}

let clock = Date.UTC(2026, 10, 1);
const ev = (conceptId: string, eventType: string, o: Partial<EvidenceEvent> = {}): EvidenceEvent => ({
  conceptId, eventType, createdAt: new Date((clock += 60_000)), mcqCorrect: null, qualityRating: null, eventMetadata: {}, ...o,
});
const mcq = (id: string, correct: boolean, failureReason?: string) => ev(id, "mcq_attempt", { mcqCorrect: correct, eventMetadata: failureReason ? { failureReason } : {} });

// 1. Scoring single events
assert(scoreEvent(mcq("a", true))?.score === 1 && scoreEvent(mcq("a", true))?.cause === null, "1a: right MCQ = 1, no cause");
assert(scoreEvent(mcq("a", false, "could_not_recall"))?.cause === "knowledge", "1b: could not recall = knowledge miss");
assert(scoreEvent(mcq("a", false, "careless_mistake"))?.cause === "execution" && scoreEvent(mcq("a", false, "misunderstood_question"))?.cause === "execution", "1c: careless / misread = execution slip");
assert(scoreEvent(mcq("a", false, "guessed"))?.cause === "calibration" && scoreEvent(mcq("a", false, "not_sure"))?.cause === "calibration", "1d: guessed / unsure = calibration");
assert(scoreEvent(mcq("a", false, "overconfident"))?.cause === "knowledge", "1e: overconfident = a wrong fact held confidently");
assert(scoreEvent(mcq("a", false))?.cause === "unexplained" && scoreEvent(mcq("a", false, "made_up"))?.cause === "unexplained", "1f: no or unknown reason = unexplained");
assert(scoreEvent(ev("a", "repair_verification", { eventMetadata: { verificationCorrect: false } }))?.cause === "knowledge", "1g: failed repair check = knowledge miss");
assert(scoreEvent(ev("a", "repair_verification", { eventMetadata: { verificationCorrect: true } }))?.score === 1, "1h: passed repair check = 1");
assert(scoreEvent(ev("a", "repair_verification", { eventMetadata: {} })) === null, "1i: repair event without an outcome is not an answer");
assert(scoreEvent(ev("a", "review", { qualityRating: 3, eventMetadata: { writtenScore: 6.5 } }))?.score === 0.65, "1j: written answer = mark / 10");
assert(scoreEvent(ev("a", "review", { eventMetadata: { writtenScore: 6, writtenMaxScore: 15 } }))?.score === 0.4, "1k: written answer with a stated maximum");
assert(Math.abs((scoreEvent(ev("a", "review", { qualityRating: 3, eventMetadata: { clozeCorrect: 2, clozeTotal: 3 } }))?.score ?? 0) - 2 / 3) < 1e-9, "1l: recall blanks = right / total");
assert(scoreEvent(ev("a", "review", { qualityRating: 5 }))?.score === 1 && scoreEvent(ev("a", "review", { qualityRating: 1 }))?.score === 0, "1m: plain recall uses quality 1..5");
assert(scoreEvent(ev("a", "self_assessment", { qualityRating: 5 })) === null, "1n: a self-assessment is not an answer");
assert(scoreEvent(ev("a", "repair_understanding", { eventMetadata: { postRepairUnderstanding: "understood" } })) === null, "1o: 'I understand now' is not an answer");
assert(scoreEvent(mcq("a", true) && ev("a", "mcq_attempt", { mcqCorrect: null })) === null, "1p: MCQ without a result is ignored");

// 2. The flaw being fixed: wrong answers must not raise the score
const concepts = [
  { id: "e1", name: "Fiscal deficit", subject: "Economy" },
  { id: "e2", name: "Repo rate", subject: "Economy" },
  { id: "e3", name: "GST council", subject: "Economy" },
  { id: "p1", name: "Article 200", subject: "Polity" },
  { id: "p2", name: "Federalism", subject: "Polity" },
  { id: "g1", name: "Monsoon", subject: "Geography" },
  { id: "x1", name: "Integrity", subject: "Ethics" },
];
const allWrong = buildAnswerEvidence(concepts, [mcq("e1", false, "could_not_recall"), mcq("e2", false, "concept_not_understood"), mcq("e3", false)]);
const econ = allWrong.subjects.find((s) => s.subject === "Economy")!;
assert(econ.accuracy === 0 && econ.mcqRight === 0 && econ.mcqTotal === 3, "2a: three wrong answers = 0% (the old page showed credit for them)");
assert(econ.needsWork === 3 && allWrong.needsWork.length === 3, "2b: each wrongly answered concept needs work immediately, not after three attempts");

// 3. Slips, recovery, needs-work
const evs = [
  mcq("p1", false, "concept_not_understood"),
  ev("p1", "repair_verification", { eventMetadata: { verificationCorrect: true } }), // recovered via repair check
  mcq("p2", false, "careless_mistake"), // slip — concept not flagged
  mcq("g1", false, "guessed"),
  mcq("g1", false, "could_not_recall"),
  ev("g1", "review", { qualityRating: 3, eventMetadata: { writtenScore: 3 } }), // still a miss
  ev("g1", "skip"),
];
const r = buildAnswerEvidence(concepts, evs, ["Polity", "Geography", "Economy", "History", "Ethics"]);
const polity = r.subjects.find((s) => s.subject === "Polity")!;
assert(polity.answers === 3 && Math.abs(polity.accuracy! - 1 / 3) < 1e-9, `3a: accuracy across all answers (got ${polity.accuracy})`);
assert(polity.needsWork === 0, "3b: a careless slip does not flag the concept; a repaired concept is not flagged");
assert(r.totals.recovered === 1, "3c: a concept answered right after a miss is recovered");
const geo = r.needsWork.find((c) => c.conceptId === "g1")!;
assert(geo && geo.misses === 3 && geo.latestCause === "knowledge", "3d: repeated misses counted, latest cause shown");
assert(r.missesByCause.knowledge === 3 && r.missesByCause.execution === 1 && r.missesByCause.calibration === 1, `3e: misses by cause (got ${JSON.stringify(r.missesByCause)})`);
assert(r.totals.skips === 1 && r.totals.answers === 6, "3f: skips counted apart, never as answers");
assert(r.subjects.map((s) => s.subject).join() === "Polity,Geography,Economy,Ethics", "3g: subject order follows the syllabus list; subjects with no concepts left out");
const ethics = r.subjects.find((s) => s.subject === "Ethics")!;
assert(ethics.accuracy === null && ethics.conceptsTested === 0 && ethics.concepts === 1, "3h: untested subject has no accuracy");
assert(polity.tooFewToJudge === false && r.subjects.find((s) => s.subject === "Geography")!.tooFewToJudge === false, "3i: three answers are enough to judge");
assert(buildAnswerEvidence(concepts, [mcq("e1", true)]).subjects.find((s) => s.subject === "Economy")!.tooFewToJudge, "3j: one answer is too few to judge");
assert(r.totals.conceptsTested === 3 && r.totals.concepts === 7, "3k: tested coverage");
assert(buildAnswerEvidence(concepts, [mcq("zz", false)]).totals.answers === 0, "3l: events for concepts outside the scope are ignored");

// 4. Order: the latest answer decides
const flip = buildAnswerEvidence(concepts, [mcq("e1", true), mcq("e1", false, "could_not_recall")]);
assert(flip.needsWork.length === 1 && flip.totals.recovered === 0, "4a: right then wrong = needs work");
const shuffled = buildAnswerEvidence(concepts, [
  { ...mcq("e2", true), createdAt: new Date(Date.UTC(2026, 10, 9)) },
  { ...mcq("e2", false, "could_not_recall"), createdAt: new Date(Date.UTC(2026, 10, 2)) },
]);
assert(shuffled.needsWork.length === 0 && shuffled.totals.recovered === 1, "4b: ordered by time, not by input order");

// 5. Recommendations
const recs = r.recommendations.map((x) => x.text);
assert(recs[0].startsWith("Revise Monsoon: missed 3 times"), `5a: revise the most-missed concept first (got ${recs[0]})`);
assert(recs.some((t) => t.startsWith("Focus on Geography: 10% correct across 3 answers")), `5b: focus on the weakest judged subject (got ${recs.join(" | ")})`);
assert(recs.some((t) => t.startsWith("Test yourself on Economy: 3 concepts studied, no answers yet")), "5c: untested subject with the most concepts");
const slips = buildAnswerEvidence(concepts, [mcq("e1", false, "careless_mistake"), mcq("e2", false, "misunderstood_question"), mcq("e3", false, "careless_mistake"), mcq("p1", false, "could_not_recall")]);
assert(slips.recommendations.some((x) => x.kind === "habit" && x.text.includes("3 wrong answers were slips")), "5d: frequent slips give a habit recommendation");
assert(slips.needsWork.map((c) => c.conceptId).join() === "p1", "5e: only the knowledge miss needs work");
assert(buildAnswerEvidence(concepts, []).recommendations.length <= 1 && buildAnswerEvidence(concepts, []).totals.accuracy === null, "5f: no answers, no accuracy");

// 6. Wiring
const route = readFileSync(join(process.cwd(), "src/app/api/insights/evidence/route.ts"), "utf8");
assert(route.includes("getAuthenticatedUser") && route.includes("matchesScope(c.extractionMetadata, scope)") && !/cache|adaptiveProfile/i.test(route.replace(/Not cached/g, "")), "6a: live, authenticated, scope-aware");
const ui = readFileSync(join(process.cwd(), "src/components/features/insights/InsightsDashboard.tsx"), "utf8");
assert(ui.includes("/api/insights/evidence") && ui.includes("What your answers show") && ui.includes("not how well you know it"), "6b: page leads with answer evidence and labels logging-based sections");
assert(!ui.includes("Subject Strengths") && !ui.includes("Strongest:"), "6c: the stage-based 'strength' and 'strongest' labels are gone");
assert(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(ui), "6d: no emoji");

console.log(`\n  Passed: ${passed}\n  Failed: ${failed}`);
if (failures.length) { console.log("\n  Failures:"); failures.forEach((f) => console.log(`    - ${f}`)); }
console.log(`\n  ${failed === 0 ? "✅ ANSWER EVIDENCE: VALIDATED" : "❌ ANSWER EVIDENCE: ISSUES FOUND"}\n`);
process.exit(failed > 0 ? 1 : 0);
