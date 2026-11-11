/**
 * Newspaper page chat — retrieval, prompt, reply checks, wiring.
 *
 * Run: npx tsx src/lib/newspaper/__tests__/page-chat.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  retrievalTerms,
  splitPassages,
  selectPassages,
  rankByTerms,
  trimHistory,
  retrievalQuery,
  buildChatPrompt,
  chatModelSchema,
  chatRequestSchema,
  validIndices,
  unverifiedPyqYears,
  tidyBullets,
  CHAT_SYSTEM_PROMPT,
  PAGE_CONTEXT_CHARS,
  PASSAGE_CHARS,
} from "@/lib/newspaper/page-chat";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string): void {
  if (c) passed++;
  else { failed++; failures.push(label); console.error(`  ✗ FAIL: ${label}`); }
}

// 1. Retrieval terms
const terms = retrievalTerms("What did the RBI's MPC decide about the repo rates on this page?");
assert(terms.includes("rbi") && terms.includes("mpc"), "1a: three-letter acronyms kept");
assert(terms.includes("repo") && terms.includes("rate"), "1b: plural folded (rates → rate)");
assert(!terms.includes("what") && !terms.includes("page") && !terms.includes("the"), "1c: question words and stop words dropped");
assert(!retrievalTerms("2019 1950").length, "1d: bare numbers dropped");

// 2. Passages
const mk = (word: string, n: number) => Array(n).fill(`${word} filler sentence about the topic.`).join(" ");
const page = [
  `MPC holds repo rate. ${mk("monetary", 25)}`,
  `Governor assent to State Bills under Article 200. ${mk("legislature", 25)}`,
  `Urban floods and NDMA guidelines. ${mk("drainage", 25)}`,
  `Cricket final result. ${mk("stadium", 25)}`,
  `Wetlands and Ramsar sites. ${mk("wetland", 25)}`,
  `Semiconductor mission. ${mk("chip", 25)}`,
].join("\n\n");
const passages = splitPassages(page);
assert(passages.length >= 6 && passages.every((p) => p.text.length <= PASSAGE_CHARS + 50), `2a: page split into bounded passages (got ${passages.length})`);
assert(passages.every((p, i) => p.index === i), "2b: passages indexed in page order");
const longPara = splitPassages(mk("single", 200));
assert(longPara.length > 1 && longPara.every((p) => p.text.length <= PASSAGE_CHARS + 50), "2c: an over-long paragraph is split at sentences");

const small = splitPassages("Short page about the repo rate.");
const smallSel = selectPassages(small, "anything");
assert(!smallSel.partial && smallSel.passages.length === 1, "2d: a page that fits is used whole");

const sel = selectPassages(passages, "What did the court say about the Governor and Article 200?");
assert(sel.partial, "2e: a long page is marked partial");
assert(sel.passages.some((p) => p.text.includes("Article 200")), "2f: the relevant passage is chosen");
assert(!sel.passages.some((p) => p.text.includes("Cricket")), "2g: unrelated passages are left out");
assert(sel.passages.reduce((n, p) => n + p.text.length, 0) <= PAGE_CONTEXT_CHARS, "2h: within the budget");
assert(sel.passages.every((p, i, a) => i === 0 || a[i - 1].index < p.index), "2i: chosen passages kept in page order");
const generic = selectPassages(passages, "What matters on this page?");
assert(generic.passages[0].index === 0 && generic.passages.length > 0, "2j: a question with no specific terms reads the page from the top");

// 3. Ranking notes / syllabus / PYQs
const notes = [
  { id: "a", text: "Role of the Governor in Centre-State relations governor article 200" },
  { id: "b", text: "Monetary Policy Committee repo rate inflation targeting" },
  { id: "c", text: "Geopolitics great power rivalry" },
  { id: "d", text: "Agriculture" },
];
const rbiText = "MPC keeps repo rate unchanged; RBI Governor chairs the committee; inflation targeting.";
const rbi = rankByTerms(notes, rbiText, (n) => n.text, 3, 2).map((n) => n.id);
assert(rbi[0] === "b" && !rbi.includes("a"), `3a: needs two shared terms, so one shared word ("governor") is not enough (got ${rbi})`);
assert(!rbi.includes("c"), "3b: unrelated note excluded");
assert(rankByTerms(notes, "agriculture prices", (n) => n.text, 3, 2).map((n) => n.id).join() === "d", "3c: a one-word item needs only its one word");

// 4. History
const hist = Array.from({ length: 10 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `m${i} ${"x".repeat(2000)}` }));
const trimmed = trimHistory(hist);
assert(trimmed.length === 6 && trimmed[5].content.startsWith("m9"), "4a: last six messages kept, newest last");
assert(trimmed.every((m) => m.content.length <= 1_201), "4b: each message trimmed");
assert(retrievalQuery("why?", [{ role: "user", content: "Governor assent" }, { role: "assistant", content: "..." }]).includes("Governor assent"), "4c: follow-ups retrieve with the previous question");
assert(retrievalQuery("why?", []) === "why?", "4d: first question alone");

// 5. Prompt
const prompt = buildChatPrompt({
  newspaper: "The Hindu", editionDate: "2026-11-11", pageNumber: 3,
  passages: [{ index: 0, text: "PASSAGE ONE" }, { index: 2, text: "PASSAGE THREE" }], partial: true,
  notes: [{ name: "Federalism", coreIdea: "Division of powers", facts: ["Seventh Schedule"] }],
  syllabus: [{ paper: "GS2", domain: "Polity", topic: "federal structure" }],
  pastQuestions: [],
  history: [{ role: "user", content: "earlier q" }],
  question: "What does the judgment change?",
});
assert(prompt.includes("PASSAGE ONE") && prompt.includes("PASSAGE THREE") && prompt.includes("only the passages most relevant"), "5a: page passages and partial notice");
assert(prompt.includes("0: Federalism: Division of powers; Seventh Schedule"), "5b: notes listed by index");
assert(prompt.includes("0: GS2 > Polity > federal structure"), "5c: syllabus listed by index");
assert(prompt.includes("Do not mention any past-year UPSC question"), "5d: with no verified PYQs the model is told not to cite any");
assert(prompt.includes("Student: earlier q") && prompt.endsWith("STUDENT'S QUESTION: What does the judgment change?"), "5e: history then question");
assert(/"beyond"/.test(CHAT_SYSTEM_PROMPT) && /never in "answer"/.test(CHAT_SYSTEM_PROMPT), "5f: outside background goes to a separate field");
assert(/Never claim that UPSC asked/.test(CHAT_SYSTEM_PROMPT) && /author argues/.test(CHAT_SYSTEM_PROMPT) && /outOfScope/.test(CHAT_SYSTEM_PROMPT), "5g: PYQ, opinion and scope rules");
assert(!/[\u{1F300}-\u{1FAFF}]/u.test(CHAT_SYSTEM_PROMPT), "5h: no emoji");

// 6. Reply contract and checks
const reply = chatModelSchema.safeParse({ answer: "The court held...", notesUsed: [0, 7], syllabusUsed: "x", outOfScope: "no" });
assert(reply.success && reply.data.beyond === "" && reply.data.syllabusUsed.length === 0 && reply.data.outOfScope === false, "6a: missing or malformed fields fall back safely");
assert(!chatModelSchema.safeParse({ answer: "" }).success, "6b: an empty answer is rejected");
assert(validIndices([0, 7, 0, -1, 1.5, 2], 3).join() === "0,2", "6c: only indices of supplied items, deduplicated");

assert(unverifiedPyqYears("This was asked in UPSC Prelims 2019.", []).join() === "2019", "6d: an unbacked 'asked in 2019' is flagged");
assert(unverifiedPyqYears("UPSC 2021 Mains had a similar question.", [2021]).length === 0, "6e: a year backed by a supplied PYQ is not flagged");
assert(unverifiedPyqYears("Relevant for Prelims; the 2011 Census counted 121 crore people.", []).length === 0, "6f: an ordinary year near the word Prelims is not a PYQ claim");
assert(unverifiedPyqYears("The Commission was set up in 2002 and matters for GS2.", []).length === 0, "6g: 'set up in 2002' is not a PYQ claim");
assert(unverifiedPyqYears("A 2018 Prelims question tested this.", []).join() === "2018", "6h: 'a 2018 Prelims question' is flagged");
assert(unverifiedPyqYears("Previous year questions (2016, 2020) in Mains covered this.", [2016]).join() === "2020", "6i: each unbacked year listed");

assert(
  tidyBullets("It highlights: - the flood problem; - NDMA guidelines. - funds") === "It highlights:\n- the flood problem;\n- NDMA guidelines.\n- funds",
  "6j: inline bullets put on their own lines",
);
assert(tidyBullets("Between 1950 - 1960, a well-known co-operative model") === "Between 1950 - 1960, a well-known co-operative model", "6k: ranges and hyphenated words untouched");

// 7. Request contract
const base = { editionDate: "2026-11-11", pageNumber: 2, question: "What is new here?" };
const okReq = chatRequestSchema.safeParse(base);
assert(okReq.success && okReq.data.newspaper === "The Hindu" && okReq.data.history.length === 0, "7a: defaults");
assert(!chatRequestSchema.safeParse({ ...base, question: " " }).success, "7b: blank question rejected");
assert(!chatRequestSchema.safeParse({ ...base, question: "x".repeat(1001) }).success, "7c: over-long question rejected");
assert(!chatRequestSchema.safeParse({ ...base, history: [{ role: "system", content: "x" }] }).success, "7d: only user/assistant history accepted");

// 8. Wiring
const svc = readFileSync(join(process.cwd(), "src/lib/newspaper/page-chat.service.ts"), "utf8");
assert(!/\.(create|createMany|upsert|update|delete)\w*\(/.test(svc), "8a: chat service writes nothing");
assert(svc.includes("unverifiedPyqYears(") && svc.includes("validIndices(out.notesUsed"), "8b: reply references are checked");
const route = readFileSync(join(process.cwd(), "src/app/api/newspaper/chat/route.ts"), "utf8");
assert(route.includes("getAuthenticatedUser") && route.includes("chatRequestSchema.safeParse"), "8c: route authenticates and validates");
const chat = readFileSync(join(process.cwd(), "src/components/features/newspaper/PageChat.tsx"), "utf8");
assert(chat.includes("Background, not from this page") && chat.includes("could not verify"), "8d: UI separates background and flags unverified past papers");
assert(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(chat), "8e: no emoji in the chat UI");
const reader = readFileSync(join(process.cwd(), "src/components/features/newspaper/NewspaperReader.tsx"), "utf8");
assert(reader.includes("key={pageKey}"), "8f: chat remounts per page, so a pending answer never shows on another page");

console.log(`\n  Passed: ${passed}\n  Failed: ${failed}`);
if (failures.length) { console.log("\n  Failures:"); failures.forEach((f) => console.log(`    - ${f}`)); }
console.log(`\n  ${failed === 0 ? "✅ PAGE CHAT: VALIDATED" : "❌ PAGE CHAT: ISSUES FOUND"}\n`);
process.exit(failed > 0 ? 1 : 0);
