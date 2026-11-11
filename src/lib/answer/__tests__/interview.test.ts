/**
 * Interview answers — delivery metrics, audio checks, prompt, schema.
 *
 * Run: npx tsx src/lib/answer/__tests__/interview.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeDelivery,
  whisperPrompt,
  isAllowedAudio,
  baseMime,
  buildInterviewPrompt,
  interviewEvaluationSchema,
  normalizeInterviewScore,
  INTERVIEW_SYSTEM_PROMPT,
} from "@/lib/answer/interview";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string): void {
  if (c) passed++;
  else { failed++; failures.push(label); console.error(`  ✗ FAIL: ${label}`); }
}

// 1. Delivery metrics
const t = "Um, so I think geospatial data, uh, is basically the backbone of disaster management. I like maps. You know, like, NDMA uses it. I mean, early warning matters.";
const d = computeDelivery(t, 30, [
  { start: 0, end: 8, text: "a" },
  { start: 12, end: 20, text: "b" }, // 4 s gap → long pause
  { start: 21, end: 30, text: "c" },
]);
assert(d.words === t.split(/\s+/).length && d.durationSeconds === 30, "1a: words and duration");
assert(d.wordsPerMinute === Math.round(d.words / 0.5), "1b: wpm = words / minutes");
const fillerMap = Object.fromEntries(d.topFillers.map((f) => [f.filler, f.count]));
assert((fillerMap["um"] ?? 0) === 1 && (fillerMap["uh"] ?? 0) === 1, "1c: um/uh counted");
assert(d.fillerCount >= 6, `1d: basically, you know, I mean and filler-like counted (got ${d.fillerCount})`);
assert(!d.topFillers.some((f) => f.filler === "like" && f.count > 1), "1e: 'I like maps' is not a filler; only ', like,' is");
assert(d.longPauses === 1, "1f: one gap of ≥ 3 s");
assert(d.lengthLabel === "good length" && computeDelivery("a b c", 20).lengthLabel === "too short" && computeDelivery("a", 200).lengthLabel === "too long", "1g: length labels");
assert(computeDelivery(Array(150).fill("w").join(" "), 60).paceLabel === "conversational" && computeDelivery(Array(60).fill("w").join(" "), 60).paceLabel === "too slow" && computeDelivery(Array(220).fill("w").join(" "), 60).paceLabel === "too fast", "1h: pace labels");
assert(computeDelivery("", 0).words === 0 && Number.isFinite(computeDelivery("", 0).wordsPerMinute), "1i: empty transcript is safe");

// 2. Audio checks and Whisper prompt
assert(isAllowedAudio("audio/webm;codecs=opus") && isAllowedAudio("audio/mp4") && !isAllowedAudio("video/mp4") && !isAllowedAudio("application/pdf"), "2a: audio types");
assert(baseMime("audio/webm; codecs=opus") === "audio/webm", "2b: codec parameters stripped");
const wp = whisperPrompt("Latitude and Longitude", ["GIS", "NavIC"]);
assert(/Umm/.test(wp) && /uh/.test(wp) && wp.includes("NavIC"), "2c: Whisper prompt keeps fillers and seeds concept terms");

// 3. Board prompt and schema
const p = buildInterviewPrompt({ prompt: "How can geospatial data improve disaster management?", dimensions: ["Technical feasibility", "Policy framework"], transcript: t, delivery: d, conceptName: "Latitude and Longitude" });
assert(p.includes("Technical feasibility | Policy framework") && p.includes("wpm") === false && p.includes("words/min"), "3a: dimensions and measured metrics included");
assert(p.includes('"followUp"') && p.includes('"strongerAnswer"'), "3b: asks for a board follow-up and a stronger-answer outline");
assert(INTERVIEW_SYSTEM_PROMPT.includes("Personality Test") && INTERVIEW_SYSTEM_PROMPT.includes("5/10 is an average"), "3c: board persona with strict calibration");
const ok = interviewEvaluationSchema.safeParse({ score: 6, verdict: "good", dimensions: [{ name: "Policy", rating: "adequate", comment: "x" }], strengths: ["a"], gaps: ["b"], inaccuracies: [], balance: "b", delivery: "d", followUp: "f", strongerAnswer: ["s"], improvement: "i" });
assert(ok.success, "3d: well-formed evaluation accepted");
const sloppy = interviewEvaluationSchema.safeParse({ score: 4, verdict: "weak", dimensions: "nope", improvement: "x" });
assert(sloppy.success && sloppy.data.dimensions.length === 0 && sloppy.data.followUp === "", "3e: malformed fields degrade, not fail");
assert(normalizeInterviewScore(7.26) === 7.3 && normalizeInterviewScore(11) === 10, "3f: score normalised");

// 4. Wiring
const card = readFileSync(join(process.cwd(), "src/components/features/practice/PracticeCard.tsx"), "utf8");
assert(card.includes("<VoiceAnswer") && card.includes('answerMode: "interview"'), "4a: Practice interview prompts have the recorder and record a review event");
const route = readFileSync(join(process.cwd(), "src/app/api/revision/route.ts"), "utf8");
assert(route.includes('"voice"') && route.includes('"interview"'), "4b: revision route accepts voice / interview evidence");

console.log(`\n  Passed: ${passed}\n  Failed: ${failed}`);
if (failures.length) { console.log("\n  Failures:"); failures.forEach((f) => console.log(`    - ${f}`)); }
console.log(`\n  ${failed === 0 ? "✅ INTERVIEW: VALIDATED" : "❌ INTERVIEW: ISSUES FOUND"}\n`);
process.exit(failed > 0 ? 1 : 0);
