/**
 * Newspaper story threads and weekly / monthly compilations.
 *
 * Run: npx tsx src/lib/newspaper/__tests__/stories-compilation.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analysisSchema, buildAnalysisPrompt } from "@/lib/newspaper/newspaper";
import {
  storyIdOf,
  toStoryEntry,
  latestPerStory,
  pickRecentStories,
  resolveContinuation,
  daysBefore,
  storyCandidates,
  buildConfirmPrompt,
  confirmedPairs,
  CONFIRM_SYSTEM_PROMPT,
  type StoryEntry,
} from "@/lib/newspaper/stories";
import {
  periodRange,
  primaryPaper,
  buildCompilation,
  compilationHtml,
  shortDate,
  type CompilableArticle,
} from "@/lib/newspaper/compilation";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string): void {
  if (c) passed++;
  else { failed++; failures.push(label); console.error(`  ✗ FAIL: ${label}`); }
}

// 1. Story ids and entries
assert(storyIdOf({ id: "c1", extractionMetadata: { storyId: "s9" } }) === "s9", "1a: stored story id used");
assert(storyIdOf({ id: "c1", extractionMetadata: {} }) === "c1" && storyIdOf({ id: "c2", extractionMetadata: null }) === "c2", "1b: a concept without one is its own story");
const e = toStoryEntry({ id: "c1", displayName: "Governor's assent", keywords: ["article 200"], extractionMetadata: { storyId: "s1", editionDate: "2026-11-11", pageNumber: 3, headline: "SC on Bills" } });
assert(e.storyId === "s1" && e.editionDate === "2026-11-11" && e.pageNumber === 3 && e.headline === "SC on Bills", "1c: entry fields");

const entry = (storyId: string, conceptId: string, editionDate: string, pageNumber: number, topic: string, headline: string, keywords: string[] = []): StoryEntry =>
  ({ storyId, conceptId, editionDate, pageNumber, topic, headline, keywords });
const gov1 = entry("sGov", "g1", "2026-11-09", 1, "Governor's assent to State Bills", "Supreme Court: Governors cannot sit on Bills", ["article 200", "governor"]);
const gov2 = entry("sGov", "g2", "2026-11-10", 4, "Governor's assent to State Bills", "Centre to seek review of Governor ruling", ["governor"]);
const rbi = entry("sRbi", "r1", "2026-11-10", 1, "RBI repo rate decision", "MPC keeps repo rate unchanged", ["repo rate", "monetary policy"]);
const flood = entry("sFlood", "f1", "2026-11-08", 2, "Urban flood management", "Cities need to plan for floods", ["urban flooding", "ndma"]);

const latest = latestPerStory([gov1, rbi, gov2, flood]);
assert(latest.length === 3 && latest.find((s) => s.storyId === "sGov")?.conceptId === "g2", "1d: latest development per story");
assert(latest[0].editionDate >= latest[1].editionDate && latest[1].editionDate >= latest[2].editionDate, "1e: newest first");
const samePage = latestPerStory([entry("x", "a", "2026-11-10", 2, "t", "h"), entry("x", "b", "2026-11-10", 5, "t", "h")]);
assert(samePage[0].conceptId === "b", "1f: same date, later page wins");

// 2. Stories offered to the model
const pageText = "States move court again as Governor delays assent to Bills passed by the Assembly; Article 200 debate.";
const offered = pickRecentStories(latest, pageText);
assert(offered.length === 1 && offered[0].storyId === "sGov", `2a: only stories sharing specific terms with the page are offered (got ${offered.map((s) => s.storyId)})`);
assert(pickRecentStories(latest, "Cricket final at the stadium").length === 0, "2b: nothing offered for an unrelated page");
assert(pickRecentStories(Array.from({ length: 40 }, (_, i) => entry(`s${i}`, `c${i}`, "2026-11-10", 1, "Governor issue", `h${i}`)), pageText, 20).length === 20, "2c: capped");
assert(daysBefore("2026-11-11", 30) === "2026-10-12" && daysBefore("2026-03-01", 1) === "2026-02-28", "2d: date arithmetic");

// 3. Continuation resolution
const base = {
  headline: "States move court again over pending Bills",
  kind: "news",
  relevance: "high",
  topic: "Governor's assent to State Bills",
  subject: "Polity",
  gsPapers: ["GS2"],
  summary: "Three States approached the Supreme Court as the Governor delayed assent to Bills despite the earlier ruling.",
  whyItMatters: "Centre-State relations and Article 200.",
  keyFacts: [],
  staticLinkage: [],
  keywords: ["governor", "article 200"],
  relatedTopics: [],
  mainsAngle: "",
  prelimsMcqs: [],
  mainsQuestion: null,
};
const parse = (o: Record<string, unknown>) => analysisSchema.parse({ articles: [o] }).articles[0];
assert(resolveContinuation(parse({ ...base, continuesStory: 0 }), offered)?.storyId === "sGov", "3a: a valid index with shared terms continues the story");
assert(resolveContinuation(parse({ ...base, continuesStory: null }), offered) === null, "3b: null starts a new story");
assert(resolveContinuation(parse({ ...base, continuesStory: 5 }), offered) === null, "3c: an out-of-range index is ignored");
assert(resolveContinuation(parse({ ...base, continuesStory: -1 }), offered) === null, "3d: a negative index is ignored");
const unrelated = parse({ ...base, topic: "Semiconductor mission", headline: "Chip plant approved", summary: "Cabinet approved a new chip fabrication unit under the semiconductor mission.", keywords: ["semiconductor"], continuesStory: 0 });
assert(resolveContinuation(unrelated, offered) === null, "3e: the model's pick is rejected when the article shares no specific term with the story");
assert(parse({ ...base, continuesStory: "zero" }).continuesStory === null, "3f: a malformed value falls back to null");

// 3b. Focused confirmation
const govFollowUp = parse({ ...base, continuesStory: null });
const cands = storyCandidates(govFollowUp, offered);
assert(cands.length === 1 && cands[0].storyId === "sGov", "3g: an unlinked article sharing two or more specific terms becomes a candidate");
const rupee = parse({ ...base, topic: "Digital rupee pilot", headline: "RBI widens e-rupee pilot", summary: "The Reserve Bank extended its CBDC retail pilot; the Governor said the e-rupee is legal tender.", keywords: ["cbdc", "digital rupee"], continuesStory: null });
assert(storyCandidates(rupee, [rbi, ...offered]).length === 0, "3h: one shared word (Governor) does not make a candidate");
const pairs = [{ article: govFollowUp, story: gov2 }, { article: govFollowUp, story: gov1 }, { article: rupee, story: rbi }];
const cp = buildConfirmPrompt(pairs);
assert(cp.includes("PAIR 0") && cp.includes("PAIR 2") && cp.includes("EARLIER STORY (2026-11-10)"), "3i: confirmation prompt lists pairs with dates");
assert(/digital-rupee pilot does not continue an RBI interest-rate decision/.test(CONFIRM_SYSTEM_PROMPT), "3j: confirmation rule names the same-institution trap");
const conf = confirmedPairs(pairs, [{ pair: 0, same: true }, { pair: 1, same: true }, { pair: 2, same: false }, { pair: 9, same: true }]);
assert(conf.length === 1 && conf[0].story.conceptId === "g2", "3k: first confirmed story per article; rejections and bad indices ignored");

// 4. Prompt
const prompt = buildAnalysisPrompt({ chunk: "TEXT", newspaper: "The Hindu", editionDate: "2026-11-12", pageNumber: 1, part: 1, parts: 1, studentTopics: [], recentStories: offered });
assert(prompt.includes("RECENT STORIES FROM EARLIER EDITIONS") && prompt.includes("0: 2026-11-10: Governor's assent to State Bills: Centre to seek review"), "4a: recent stories listed by index with date");
assert(/A different event on a similar theme is NOT a continuation/.test(prompt) && prompt.includes('"continuesStory": null'), "4b: continuation rule and field in the format");
assert(!buildAnalysisPrompt({ chunk: "T", newspaper: "N", editionDate: "2026-11-12", pageNumber: 1, part: 1, parts: 1, studentTopics: [] }).includes("RECENT STORIES"), "4c: no list when nothing is offered");

// 5. Periods
const w = periodRange("week", "2026-11-11"); // Wednesday
assert(w.from === "2026-11-09" && w.to === "2026-11-15", `5a: week runs Monday to Sunday (got ${w.from}..${w.to})`);
assert(periodRange("week", "2026-11-09").from === "2026-11-09" && periodRange("week", "2026-11-15").from === "2026-11-09", "5b: Monday and Sunday belong to the same week");
assert(w.prevAnchor === "2026-11-02" && w.nextAnchor === "2026-11-16", "5c: neighbouring weeks");
assert(w.label === "Week of 9 Nov to 15 Nov 2026", `5d: week label (got ${w.label})`);
const m = periodRange("month", "2026-02-14");
assert(m.from === "2026-02-01" && m.to === "2026-02-28" && m.label === "February 2026", "5e: calendar month");
assert(periodRange("month", "2026-12-05").nextAnchor === "2027-01-01" && periodRange("month", "2026-01-05").prevAnchor === "2025-12-01", "5f: month rollover across years");
assert(periodRange("week", "2026-12-30").to === "2027-01-03", "5g: a week can cross the year end");
assert(shortDate("2026-11-09") === "9 Nov", "5h: short date");

// 6. Papers
assert(primaryPaper(["Prelims", "GS3"]) === "GS3" && primaryPaper(["Prelims"]) === "Prelims" && primaryPaper([]) === "Prelims", "6a: first Mains paper, else Prelims");

// 7. Compilation
const art = (o: Partial<CompilableArticle> & { conceptId: string; storyId: string; editionDate: string }): CompilableArticle => ({
  pageNumber: 1, newspaper: "The Hindu", topic: "Topic", headline: `H ${o.conceptId}`, kind: "news", relevance: "medium", subject: "Polity",
  gsPapers: ["Prelims", "GS2"], summary: `Summary ${o.conceptId}`, keyFacts: ["fact"], staticLinkage: [], mainsAngle: "", prelimsCount: 1,
  mainsQuestion: "Q", story: [], ...o,
});
const arts = [
  art({ conceptId: "g1", storyId: "sGov", editionDate: "2026-11-09", topic: "Governor's assent", story: [{ conceptId: "g0", editionDate: "2026-11-02", pageNumber: 1, headline: "old" }, { conceptId: "g2", editionDate: "2026-11-11", pageNumber: 4, headline: "H g2" }] }),
  art({ conceptId: "g2", storyId: "sGov", editionDate: "2026-11-11", pageNumber: 4, topic: "Governor's assent (review)", relevance: "high", story: [{ conceptId: "g0", editionDate: "2026-11-02", pageNumber: 1, headline: "old" }, { conceptId: "g1", editionDate: "2026-11-09", pageNumber: 1, headline: "H g1" }] }),
  art({ conceptId: "r1", storyId: "sRbi", editionDate: "2026-11-10", topic: "Repo rate", subject: "Economy", gsPapers: ["Prelims", "GS3"], mainsQuestion: null }),
  art({ conceptId: "e1", storyId: "sEd", editionDate: "2026-11-12", topic: "Urban floods", kind: "editorial", gsPapers: ["Prelims"], prelimsCount: 0, mainsQuestion: null }),
  art({ conceptId: "old", storyId: "sOld", editionDate: "2026-11-02", topic: "Outside the week" }),
];
const comp = buildCompilation(w, arts);
assert(comp.totals.articles === 4 && comp.totals.stories === 3, `7a: only the period's articles, stories folded (got ${JSON.stringify(comp.totals)})`);
assert(comp.papers.map((p) => p.paper).join() === "GS2,GS3,Prelims", "7b: grouped by paper in syllabus order");
const gov = comp.papers[0].stories[0];
assert(gov.developments.map((d) => d.conceptId).join() === "g1,g2" && gov.latest.conceptId === "g2", "7c: developments oldest first, latest is the newest");
assert(gov.topic === "Governor's assent (review)" && gov.relevance === "high", "7d: story takes the latest topic and its highest relevance");
assert(gov.earlierCount === 1, "7e: reports before the period are counted, not shown");
assert(gov.questionCount === 4 && comp.totals.questions === 5, `7f: questions counted (got ${gov.questionCount}, ${comp.totals.questions})`);
assert(comp.totals.continuing === 1, "7g: stories followed across editions counted");
assert(buildCompilation(w, []).papers.length === 0 && buildCompilation(w, []).totals.stories === 0, "7h: empty period");
const dup = buildCompilation(w, [arts[2], arts[2]]);
assert(dup.totals.stories === 1 && dup.papers[0].stories[0].developments.length === 1, "7i: a repeated article is counted once");

// 8. Print document
const html = compilationHtml(buildCompilation(w, [art({ conceptId: "x", storyId: "sx", editionDate: "2026-11-10", topic: "<script>alert(1)</script>", summary: "A & B" })]), "Current affairs: <week>");
assert(!html.includes("<script>alert") && html.includes("&lt;script&gt;") && html.includes("A &amp; B") && html.includes("Current affairs: &lt;week&gt;"), "8a: all text escaped");
const opHtml = compilationHtml(comp, "T");
assert(opHtml.includes("Urban floods (opinion)") && opHtml.includes("and 1 earlier"), "8b: opinion marked, earlier reports noted");
assert(compilationHtml(buildCompilation(w, []), "T").includes("No newspaper notes in this period."), "8c: empty period printable");

// 9. Wiring
const svc = readFileSync(join(process.cwd(), "src/lib/newspaper/newspaper.service.ts"), "utf8");
assert(svc.includes("resolveContinuation(a, offered)") && svc.includes("storyId: continues.get(a)?.storyId ?? crypto.randomUUID()"), "9a: analysis resolves continuations per chunk and stores the story id");
assert(svc.includes('generatedBy: "newspaper-story"'), "9b: a story edge links each development to the previous one");
assert(svc.includes("e.editionDate === editionDate && e.pageNumber === pageNumber"), "9c: a page is never offered as its own earlier story");
const repo = readFileSync(join(process.cwd(), "src/lib/repositories/concept.repository.ts"), "utf8");
assert(repo.includes("coalesce(${concepts.extractionMetadata}->>'storyId', ${concepts.id}::text) in"), "9d: story query treats a concept without a story id as its own story");
const notesUi = readFileSync(join(process.cwd(), "src/components/features/newspaper/NewspaperNotes.tsx"), "utf8");
assert(notesUi.includes("Weekly compilation") && notesUi.includes("Monthly compilation"), "9e: compilation views in the notes section");
const compUi = readFileSync(join(process.cwd(), "src/components/features/newspaper/NewspaperCompilation.tsx"), "utf8");
assert(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(compUi + notesUi), "9f: no emoji");

console.log(`\n  Passed: ${passed}\n  Failed: ${failed}`);
if (failures.length) { console.log("\n  Failures:"); failures.forEach((f) => console.log(`    - ${f}`)); }
console.log(`\n  ${failed === 0 ? "✅ STORIES + COMPILATION: VALIDATED" : "❌ STORIES + COMPILATION: ISSUES FOUND"}\n`);
process.exit(failed > 0 ? 1 : 0);
