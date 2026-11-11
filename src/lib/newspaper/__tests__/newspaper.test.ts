/**
 * Newspaper — page text, chunking, analysis contract, merging, notes, wiring.
 *
 * Run: npx tsx src/lib/newspaper/__tests__/newspaper.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assemblePageText,
  chunkText,
  analysisSchema,
  analyseRequestSchema,
  buildAnalysisPrompt,
  mergeAnalyses,
  matchStudentTopics,
  renderNoteMarkdown,
  needsOcr,
  isIsoDate,
  MAX_CHUNK_CHARS,
  MAX_PAGE_CHARS,
  NEWSPAPER_SYSTEM_PROMPT,
  type NewspaperAnalysis,
} from "@/lib/newspaper/newspaper";
import { guessEditionDate, localIsoDate } from "@/lib/newspaper/page-text";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string): void {
  if (c) passed++;
  else { failed++; failures.push(label); console.error(`  ✗ FAIL: ${label}`); }
}

// 1. Page text assembly
const items = [
  { str: "Census to decide", transform: [1, 0, 0, 1, 50, 700], hasEOL: true },
  { str: "seat readjust-", transform: [1, 0, 0, 1, 50, 688] },
  { str: "ment across States", transform: [1, 0, 0, 1, 50, 676], hasEOL: true },
  { str: "The", transform: [1, 0, 0, 1, 50, 664] },
  { str: "Commission", transform: [1, 0, 0, 1, 70, 664] },
];
const text = assemblePageText(items);
assert(text.includes("readjustment across States"), `1a: hyphenated line break re-joined (got ${JSON.stringify(text)})`);
assert(text.includes("The Commission"), "1b: items on one line joined with a space");
assert(text.split("\n")[0] === "Census to decide", "1c: EOL breaks the line");
assert(assemblePageText([]) === "", "1d: empty page");
assert(!/ {2}/.test(assemblePageText([{ str: "a  " }, { str: "  b" }])), "1e: runs of spaces collapsed");

// 2. OCR need
assert(needsOcr("   \n  ") && needsOcr("Page 3"), "2a: blank or token text needs OCR");
assert(!needsOcr("x".repeat(400)), "2b: a real text layer does not");

// 3. Chunking
const para = (n: number, ch: string) => ch.repeat(n);
const short = "Short page.";
assert(chunkText(short).length === 1 && chunkText(short)[0] === short, "3a: short page is one chunk");
assert(chunkText("   ").length === 0, "3b: blank page has no chunks");
const long = [para(4000, "a"), para(4000, "b"), para(4000, "c")].join("\n\n");
const chunks = chunkText(long);
assert(chunks.length === 2 && chunks.every((c) => c.length <= MAX_CHUNK_CHARS), `3c: paragraphs packed under the limit (got ${chunks.map((c) => c.length)})`);
assert(chunks.join("").replace(/\s/g, "").length === 12000, "3d: no text lost");
const giant = chunkText(para(20000, "z"));
assert(giant.length === 3 && giant.every((c) => c.length <= MAX_CHUNK_CHARS), "3e: an unbroken run is hard-split");
assert(chunkText(para(MAX_PAGE_CHARS + 5000, "q")).join("").length === MAX_PAGE_CHARS, "3f: page capped at MAX_PAGE_CHARS");

// 4. Analysis contract
const mcq = {
  question: "Consider the following statements about delimitation in India:",
  options: { a: "Only one", b: "Only two", c: "All three", d: "None" },
  correctAnswer: "b",
  explanation: "Statement 1 is correct; statement 2 is correct; statement 3 is incorrect.",
};
const raw = {
  articles: [
    {
      headline: "Panel to redraw constituencies after Census",
      kind: "news",
      relevance: "high",
      topic: "Delimitation of constituencies",
      subject: "Polity",
      gsPapers: ["Prelims", "GS2"],
      summary: "The government notified a Delimitation Commission to readjust seats after the Census.",
      whyItMatters: "Delimitation is a recurring Polity topic for Prelims and GS2.",
      keyFacts: ["Article 82 provides for readjustment after each Census"],
      staticLinkage: ["Article 82", "Article 170"],
      keywords: ["delimitation", "census"],
      mainsAngle: "Federal balance between populous and less populous States.",
      prelimsMcqs: [mcq, mcq, mcq],
      mainsQuestion: { question: "Discuss the federal implications of delimitation. (150 words)", guidancePoints: ["Art 82"], estimatedMarks: 10 },
    },
    { headline: "x", topic: "y", summary: "too short" },
  ],
  skipped: [{ headline: "Cricket: India win", reason: "sports result" }],
};
const parsedBad = analysisSchema.safeParse(raw);
assert(parsedBad.success && parsedBad.data.articles.length === 1 && parsedBad.data.articles[0].topic === "Delimitation of constituencies", "4a: a malformed article is dropped without discarding the valid one");
raw.articles = [raw.articles[0]];
(raw.articles[0] as Record<string, unknown>).prelimsMcqs = [mcq, mcq];
(raw.articles[0] as Record<string, unknown>).kind = "unknown-kind";
(raw.articles[0] as Record<string, unknown>).subject = "Astrology";
const parsed = analysisSchema.safeParse(raw);
assert(parsed.success, `4b: valid article parses (${parsed.success ? "" : parsed.error.issues[0]?.message})`);
if (parsed.success) {
  const a = parsed.data.articles[0];
  assert(a.kind === "news" && a.subject === "CurrentAffairs", "4c: unknown kind/subject fall back safely");
  assert(a.prelimsMcqs.length === 2 && a.mainsQuestion !== null, "4d: questions kept");
  assert(parsed.data.skipped[0].reason === "sports result", "4e: skipped items kept");
}
const threeMcqs = analysisSchema.safeParse({ articles: [{ ...raw.articles[0], prelimsMcqs: [mcq, mcq, mcq] }] });
assert(threeMcqs.success && threeMcqs.data.articles[0].prelimsMcqs.length === 0, "4f: more than two MCQs is rejected (falls back to none)");

// 5. Prompts
const prompt = buildAnalysisPrompt({ chunk: "PAGE TEXT HERE", newspaper: "The Hindu", editionDate: "2026-11-11", pageNumber: 3, part: 2, parts: 3, studentTopics: ["Federalism", "Monsoon"] });
assert(prompt.includes("PAGE TEXT HERE") && prompt.includes("page 3") && prompt.includes("part 2 of 3"), "5a: prompt carries text and page");
assert(prompt.includes("Federalism; Monsoon"), "5b: prompt lists the student's topics for linkage");
assert(!buildAnalysisPrompt({ chunk: "t", newspaper: "N", editionDate: "2026-11-11", pageNumber: 1, part: 1, parts: 1, studentTopics: [] }).includes("ALREADY STUDIED"), "5c: no topics line when the student has none");
assert(/OPINION/.test(NEWSPAPER_SYSTEM_PROMPT) && /Never invent/.test(NEWSPAPER_SYSTEM_PROMPT) && /FILTER/.test(NEWSPAPER_SYSTEM_PROMPT), "5d: system prompt filters, labels opinion, forbids invention");

// 5b. Linking to the student's notes
const studentTopics = [
  { id: "1", displayName: "Role of the Governor in Center-state relations", keywords: ["governor", "article 200"] },
  { id: "2", displayName: "Monetary Policy Framework", keywords: ["repo rate", "inflation targeting"] },
  { id: "3", displayName: "Federalism", keywords: ["cooperative federalism"] },
  { id: "4", displayName: "Geopolitics", keywords: ["great power rivalry"] },
  { id: "5", displayName: "Public Policy", keywords: [] },
];
const mpcText = "MPC keeps repo rate unchanged; RBI Governor chairs the committee; inflation targeting 4%";
const matched = matchStudentTopics(["monetary policy framework", "Made-up topic", "Monetary Policy Framework"], studentTopics, mpcText);
assert(matched.map((m) => m.id).join(",") === "2", "5e: model-chosen names map to real topics; unknown and duplicate names ignored");
assert(matchStudentTopics([], studentTopics, mpcText).length === 0, "5f: no names, no links (no word-overlap guessing): RBI Governor is not linked to State Governors");
const floodText = "Urban flooding is a planning failure; NDMA guidelines; policy gaps in city master plans";
assert(matchStudentTopics(["Geopolitics", "Public Policy"], studentTopics, floodText).length === 0, "5g: a model pick sharing no specific term (or only a generic one like 'policy') is rejected");
const art200 = "Supreme Court on Governor's assent under Article 200; cooperative federalism";
assert(matchStudentTopics(["Role of the Governor in Center-state relations", "Federalism"], studentTopics, art200, 1).length === 1, "5g2: link count capped");
assert(matchStudentTopics(["Role of the Governor in Center-state relations", "Federalism"], studentTopics, art200).length === 2, "5g3: genuine links kept");
assert(/copy names EXACTLY/.test(buildAnalysisPrompt({ chunk: "t", newspaper: "N", editionDate: "2026-11-11", pageNumber: 1, part: 1, parts: 1, studentTopics: ["Federalism"] })), "5h: prompt asks for exact names from the studied list");
assert(/GS3 = economy/.test(NEWSPAPER_SYSTEM_PROMPT), "5i: prompt maps subjects to GS papers");

// 6. Merging
if (parsed.success) {
  const a = parsed.data.articles[0];
  const partA: NewspaperAnalysis = { articles: [{ ...a, relevance: "medium" }], skipped: [{ headline: "Ad", reason: "advertisement" }] };
  const partB: NewspaperAnalysis = {
    articles: [{ ...a, topic: "Delimitation of Constituencies!", relevance: "high" }, { ...a, topic: "Monsoon outlook", relevance: "medium" }],
    skipped: [],
  };
  const merged = mergeAnalyses([partA, partB]);
  assert(merged.articles.length === 2, "6a: an article split across chunks is kept once");
  assert(merged.articles[0].relevance === "high" && merged.articles[0].topic.startsWith("Delimitation"), "6b: high relevance wins and sorts first");
  assert(merged.skipped.length === 1, "6c: skipped lists concatenated");

  // 7. Note body
  const md = renderNoteMarkdown(a, { newspaper: "The Hindu", editionDate: "2026-11-11", pageNumber: 1 });
  assert(md.startsWith("# Delimitation of constituencies") && md.includes("The Hindu, 2026-11-11, page 1"), "7a: note header cites the edition");
  assert(md.includes("## Key facts (Prelims)") && md.includes("## Static linkage") && md.includes("## Mains angle"), "7b: note sections");
  const op = renderNoteMarkdown({ ...a, kind: "editorial", keyFacts: [], staticLinkage: [], mainsAngle: "" }, { newspaper: "N", editionDate: "2026-11-11", pageNumber: 2 });
  assert(op.includes("(opinion)") && !op.includes("## Key facts"), "7c: editorials marked as opinion, empty sections omitted");
}

// 8. Request contract and dates
const okReq = analyseRequestSchema.safeParse({ editionDate: "2026-11-11", readDate: "2026-11-11", pageNumber: 1, text: "abc" });
assert(okReq.success && okReq.data.newspaper === "The Hindu", "8a: newspaper defaults to The Hindu");
assert(!analyseRequestSchema.safeParse({ editionDate: "11-11-2026", readDate: "2026-11-11", pageNumber: 1 }).success, "8b: bad date rejected");
assert(!analyseRequestSchema.safeParse({ editionDate: "2026-11-11", readDate: "2026-11-11", pageNumber: 0 }).success, "8c: page 0 rejected");
assert(!analyseRequestSchema.safeParse({ editionDate: "2026-11-11", readDate: "2026-11-11", pageNumber: 1, image: "data:application/pdf;base64,AAAA" }).success, "8d: non-image data URL rejected");
assert(isIsoDate("2026-02-28") && !isIsoDate("2026-13-01") && !isIsoDate("yesterday"), "8e: isIsoDate");
assert(guessEditionDate("TH_Delhi_2026-11-11.pdf") === "2026-11-11", "8f: YYYY-MM-DD in file name");
assert(guessEditionDate("TheHindu_11_11_2026.pdf") === "2026-11-11", "8g: DD_MM_YYYY in file name");
assert(guessEditionDate("hindu11112026.pdf") === "2026-11-11", "8h: DDMMYYYY in file name");
assert(guessEditionDate("epaper.pdf") === null && guessEditionDate("x_2026-02-31.pdf") === null, "8i: no or invalid date gives null");
assert(localIsoDate(new Date(2026, 0, 5)) === "2026-01-05", "8j: local date formatting");

// 9. Wiring
const repo = readFileSync(join(process.cwd(), "src/lib/repositories/concept.repository.ts"), "utf8");
assert(/deleteByDailyLog[\s\S]*?'source', ''\) <> 'newspaper'/.test(repo), "9a: re-extracting a day's log never deletes newspaper concepts");
const svc = readFileSync(join(process.cwd(), "src/lib/newspaper/newspaper.service.ts"), "utf8");
assert(svc.includes("auditMcqKeys(") && svc.includes("keptSet.has(m)"), "9b: only audited MCQs are saved");
assert(svc.includes("initializeForConcept") && svc.includes("conceptQuestionsRepository.upsert") && svc.includes("noteRepository.create"), "9c: each article gets a note, questions and a revision schedule");
assert(svc.includes('"current_affairs_connection"'), "9d: links use the existing relationship vocabulary");
assert(!svc.includes("force"), "9e: no re-analysis path that would delete revision evidence");
const reader = readFileSync(join(process.cwd(), "src/components/features/newspaper/NewspaperReader.tsx"), "utf8");
assert(!reader.includes("newspaper.service\"") || reader.includes("import type { PageResult }"), "9f: reader imports only types from the server service");
assert(!/[\u{1F300}-\u{1FAFF}]/u.test(reader), "9g: no emoji in the reader");
const sidebar = readFileSync(join(process.cwd(), "src/components/features/dashboard/DashboardSidebar.tsx"), "utf8");
assert(sidebar.includes("ROUTES.NEWSPAPER"), "9h: sidebar links to the newspaper page");

console.log(`\n  Passed: ${passed}\n  Failed: ${failed}`);
if (failures.length) { console.log("\n  Failures:"); failures.forEach((f) => console.log(`    - ${f}`)); }
console.log(`\n  ${failed === 0 ? "✅ NEWSPAPER: VALIDATED" : "❌ NEWSPAPER: ISSUES FOUND"}\n`);
process.exit(failed > 0 ? 1 : 0);
