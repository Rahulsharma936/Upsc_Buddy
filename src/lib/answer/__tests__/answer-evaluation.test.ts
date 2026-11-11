/**
 * Written-Answer Evaluation — contract, prompts and scoring.
 *
 * Tests:
 *   Section 1: Request validation (images, sizes, modes)
 *   Section 2: Transcription sanitising and answer combining
 *   Section 3: Score → SM-2 quality, score normalising
 *   Section 4: Marking prompt content
 *   Section 5: Evaluation schema tolerance
 *   Section 6: Isolation
 *
 * Run: npx tsx src/lib/answer/__tests__/answer-evaluation.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateRequestSchema,
  evaluationSchema,
  sanitizeTranscription,
  combineAnswer,
  scoreToQuality,
  normalizeScore,
  buildEvaluationPrompt,
  referenceToText,
  wordTarget,
  MAX_IMAGES,
  EVALUATION_SYSTEM_PROMPT,
  TRANSCRIPTION_PROMPT,
} from "@/lib/answer/answer-evaluation";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string): void {
  if (c) passed++;
  else { failed++; failures.push(label); console.error(`  ✗ FAIL: ${label}`); }
}
function section(t: string): void { console.log(`\n── ${t} ${"─".repeat(Math.max(0, 55 - t.length))}`); }

const UUID = "7045a681-0b6d-47bd-9cb4-fdc6b67aa280";
const PNG = "data:image/png;base64,iVBORw0KGgo=";

section("Section 1: Request validation");
{
  const ok = evaluateRequestSchema.safeParse({ conceptId: UUID, mode: "mains", question: "Critically examine X (150 words)", typedAnswer: "answer", marks: 10 });
  assert(ok.success, "1a: typed mains request accepted");
  assert(evaluateRequestSchema.safeParse({ conceptId: UUID, mode: "recall", question: "Explain X", images: [PNG] }).success, "1b: photo-only request accepted");
  assert(!evaluateRequestSchema.safeParse({ conceptId: UUID, mode: "essay", question: "Explain X" }).success, "1c: unknown mode rejected");
  assert(!evaluateRequestSchema.safeParse({ conceptId: "nope", mode: "recall", question: "Explain X" }).success, "1d: non-uuid concept rejected");
  assert(!evaluateRequestSchema.safeParse({ conceptId: UUID, mode: "recall", question: "Explain X", images: ["https://evil.example/x.png"] }).success, "1e: remote image URL rejected (data URLs only)");
  assert(!evaluateRequestSchema.safeParse({ conceptId: UUID, mode: "recall", question: "Explain X", images: ["data:image/svg+xml;base64,PHN2Zz4="] }).success, "1f: SVG rejected");
  assert(!evaluateRequestSchema.safeParse({ conceptId: UUID, mode: "recall", question: "Explain X", images: Array(MAX_IMAGES + 1).fill(PNG) }).success, `1g: more than ${MAX_IMAGES} pages rejected`);
  assert(!evaluateRequestSchema.safeParse({ conceptId: UUID, mode: "recall", question: "Explain X", extra: 1 }).success, "1h: unknown fields rejected (strict)");
  assert(evaluateRequestSchema.safeParse({ conceptId: UUID, mode: "mains", question: "Critically examine X", reference: ["Art 21", "Maneka Gandhi"] }).success, "1i: marking points as an array accepted");
}

section("Section 2: Transcription and combining");
{
  assert(sanitizeTranscription("<think>reasoning</think>\nArticle 21 protects life.") === "Article 21 protects life.", "2a: reasoning block stripped");
  assert(sanitizeTranscription("NO_TEXT") === "", "2b: NO_TEXT sentinel → empty");
  assert(sanitizeTranscription("```\nline one\n```") === "line one", "2c: code fences stripped");
  assert(JSON.stringify(combineAnswer("typed", null)) === JSON.stringify({ text: "typed", source: "typed" }), "2d: typed only");
  assert(combineAnswer("", "from photo").source === "photo", "2e: photo only");
  const both = combineAnswer("intro", "body");
  assert(both.source === "both" && both.text.includes("intro") && both.text.includes("body"), "2f: both combined");
}

section("Section 3: Scoring");
{
  assert(scoreToQuality(10) === 4 && scoreToQuality(7) === 4, "3a: 7+ → 4 (never 5)");
  assert(scoreToQuality(6.9) === 3 && scoreToQuality(5) === 3, "3b: 5–6.9 → 3 (pass)");
  assert(scoreToQuality(4.9) === 2 && scoreToQuality(3) === 2, "3c: 3–4.9 → 2 (fail)");
  assert(scoreToQuality(0) === 1 && scoreToQuality(2.9) === 1, "3d: below 3 → 1");
  assert(scoreToQuality(Number.NaN) === 1, "3e: NaN → 1");
  assert(normalizeScore(6.66) === 6.7 && normalizeScore(12) === 10 && normalizeScore(-1) === 0, "3f: normalise rounds and clamps");
}

section("Section 4: Marking prompt");
{
  const p = buildEvaluationPrompt({ mode: "mains", question: "Critically examine judicial review (150 words)", answer: "My answer", reference: referenceToText(["Article 13", "Kesavananda Bharati"]), note: { coreIdea: "Courts test laws against the Constitution", examTriggers: ["Art 13", "Art 32"] }, marks: 15 });
  assert(p.includes("Critically examine judicial review"), "4a: question included");
  assert(p.includes("- Article 13") && p.includes("- Kesavananda Bharati"), "4b: marking points listed");
  assert(p.includes("Courts test laws against the Constitution"), "4c: student's note included as context");
  assert(p.includes("~150 words") && p.includes("15 marks"), "4d: a word limit stated in the question wins over marks");
  assert(wordTarget("mains", "Critically examine X", 15) === 250 && wordTarget("mains", "Discuss Y", 10) === 150, "4d2: without a stated limit, marks decide (15 → 250, else 150)");
  assert(wordTarget("recall", "Explain Z") === 100 && wordTarget("mains", "Analyse W (250 words)", 10) === 250, "4d3: recall 100; stated limit honoured");
  assert(p.includes("structure"), "4e: mains asks for a structure judgement");
  const r = buildEvaluationPrompt({ mode: "recall", question: "Explain X", answer: "a" });
  assert(r.includes("recall check") && r.includes('"structure": null'), "4f: recall mode sets structure null");
  assert(EVALUATION_SYSTEM_PROMPT.includes("4/10 is an average answer") && EVALUATION_SYSTEM_PROMPT.includes("not length"), "4g: strict calibration in system prompt");
  assert(TRANSCRIPTION_PROMPT.includes("Do NOT correct") && TRANSCRIPTION_PROMPT.includes("NO_TEXT"), "4h: transcription is verbatim with a no-text sentinel");
}

section("Section 5: Evaluation schema");
{
  const good = evaluationSchema.safeParse({ score: 6, verdict: "good", covered: ["a"], missed: ["b"], inaccuracies: [], structure: null, improvement: "Add a case." });
  assert(good.success, "5a: well-formed evaluation accepted");
  const sloppy = evaluationSchema.safeParse({ score: 3, verdict: "weak", covered: "not an array", missed: null, improvement: "Be specific." });
  assert(sloppy.success && sloppy.data.covered.length === 0 && sloppy.data.missed.length === 0, "5b: malformed lists degrade to empty, not failure");
  assert(!evaluationSchema.safeParse({ score: 11, verdict: "good", improvement: "x" }).success, "5c: score above 10 rejected");
  assert(!evaluationSchema.safeParse({ score: 5, verdict: "amazing", improvement: "x" }).success, "5d: unknown verdict rejected");
}

section("Section 6: Isolation");
{
  const src = readFileSync(join(process.cwd(), "src/lib/answer/answer-evaluation.ts"), "utf8");
  const imports = src.match(/^\s*import\b.*$/gm) ?? [];
  assert(imports.length === 1 && imports[0].includes('"zod"'), "6a: pure module — only zod");
  const svc = readFileSync(join(process.cwd(), "src/lib/answer/answer-evaluation.service.ts"), "utf8");
  for (const tok of ["spaced-repetition", "lib/diagnostic", "upsertMastery", "recordReview", "logEvent("]) assert(!svc.includes(tok), `6b: service does not reference "${tok}" (writes nothing)`);
}

section("RESULTS");
console.log(`\n  Passed: ${passed}\n  Failed: ${failed}`);
if (failures.length) { console.log("\n  Failures:"); failures.forEach((f) => console.log(`    - ${f}`)); }
console.log(`\n  ${failed === 0 ? "✅ ANSWER EVALUATION: VALIDATED" : "❌ ANSWER EVALUATION: ISSUES FOUND"}\n`);
process.exit(failed > 0 ? 1 : 0);
