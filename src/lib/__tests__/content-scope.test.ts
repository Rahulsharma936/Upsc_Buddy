/**
 * Content scope filter — Practice and Revision by source (static vs current affairs).
 *
 * Run: npx tsx src/lib/__tests__/content-scope.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseScope, matchesScope, isCurrentAffairs, countByScope, scopeQuery, CONTENT_SCOPE_LABEL } from "@/lib/content-scope";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string): void {
  if (c) passed++;
  else { failed++; failures.push(label); console.error(`  ✗ FAIL: ${label}`); }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// 1. Parsing
assert(parseScope("current") === "current" && parseScope("static") === "static" && parseScope("all") === "all", "1a: known values");
assert(parseScope(null) === "all" && parseScope(undefined) === "all" && parseScope("news") === "all" && parseScope("") === "all", "1b: anything else is all");
assert(parseScope(["current", "static"]) === "current", "1c: repeated query value takes the first");

// 2. Matching
const news = { source: "newspaper", editionDate: "2026-11-11" };
const own = { source: "daily_log" };
assert(isCurrentAffairs(news) && !isCurrentAffairs(own) && !isCurrentAffairs(null) && !isCurrentAffairs({}), "2a: current affairs = newspaper source");
assert(matchesScope(news, "current") && !matchesScope(own, "current"), "2b: current scope");
assert(matchesScope(own, "static") && matchesScope(null, "static") && !matchesScope(news, "static"), "2c: static scope includes concepts with no source");
assert(matchesScope(news, "all") && matchesScope(own, "all") && matchesScope(undefined, "all"), "2d: all scope");

// 3. Counts and links
const counts = countByScope([news, own, {}, news], (x) => x);
assert(counts.all === 4 && counts.current === 2 && counts.static === 2, "3a: counts per scope");
assert(scopeQuery("all") === "" && scopeQuery("current") === "?scope=current", "3b: link query");
assert(CONTENT_SCOPE_LABEL.current === "Current affairs" && CONTENT_SCOPE_LABEL.static === "Static syllabus", "3c: labels");

// 4. Wiring — server
const practiceRoute = read("src/app/api/practice/route.ts");
assert(practiceRoute.includes('parseScope(request.nextUrl.searchParams.get("scope"))') && practiceRoute.includes("matchesScope({ source: row.concept.source }, scope)"), "4a: Practice filters its inventory by scope");
assert(!practiceRoute.includes("inventorySize: inventory.length") && practiceRoute.includes("inventorySize: scopeCounts.all"), "4b: hydration size stays the whole inventory, so an empty filter never shows 'not generated'");
const cq = read("src/lib/repositories/concept-questions.repository.ts");
assert(cq.includes("->>'source'"), "4c: inventory query selects the concept source only");
const revRepo = read("src/lib/repositories/revision.repository.ts");
assert(/getDueForRevision\(userId: string, limit = 20, scope: ContentScope = "all"\)/.test(revRepo) && revRepo.includes("innerJoin(concepts"), "4d: due concepts filtered in the query, so a narrowed session is still full");
const revSvc = read("src/lib/ai/services/revision-intelligence.service.ts");
assert(revSvc.includes('getDueForRevision(params.userId, limit * 2, params.scope ?? "all")'), "4e: recommendations pass the scope through");
assert(read("src/app/api/revision/route.ts").includes('scope: parseScope(request.nextUrl.searchParams.get("scope"))'), "4f: recommendations route reads scope");
assert(read("src/app/api/revision/session/route.ts").includes("revisionSessionService.build({ userId: user.id, limit, since, scope })"), "4g: session route reads scope");

assert(revRepo.includes("async getAllMastery(userId: string, scope: ContentScope = \"all\")") && /eventTypes: string\[\],\s+scope: ContentScope = "all"/.test(revRepo), "4h: stats and done-today counts follow the scope");
assert(read("src/components/features/revision/DueConceptsList.tsx").includes("action=stats${scope"), "4i: due list stats request the scope");

// 5. Wiring — UI
const practiceList = read("src/components/features/practice/PracticeList.tsx");
assert(practiceList.includes("<ContentScopeFilter") && practiceList.includes("fetchPractice(viewMode, scope)"), "5a: Practice shows the filter and refetches on change");
assert(practiceList.includes("No current-affairs questions yet"), "5b: empty current-affairs Practice points to the Newspaper page");
const ws = read("src/components/features/revision/RevisionWorkspace.tsx");
assert(ws.includes("<RevisionSession key={scope} scope={scope}") && ws.includes("<DueConceptsList refreshKey={refreshKey} scope={scope}"), "5c: Revision session and due list both follow the filter");
assert(read("src/app/dashboard/practice/page.tsx").includes("<PracticeList initialScope={scope} />") && read("src/app/dashboard/revision/page.tsx").includes("<RevisionWorkspace initialScope={scope} />"), "5d: pages open on ?scope= from the link");
assert(read("src/components/features/newspaper/NewspaperReader.tsx").includes("?scope=current") && read("src/components/features/newspaper/NewspaperCompilation.tsx").includes("${ROUTES.REVISION}?scope=current"), "5e: Newspaper links open filtered Practice and Revision");
assert(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(read("src/components/shared/ContentScopeFilter.tsx")), "5f: no emoji");

console.log(`\n  Passed: ${passed}\n  Failed: ${failed}`);
if (failures.length) { console.log("\n  Failures:"); failures.forEach((f) => console.log(`    - ${f}`)); }
console.log(`\n  ${failed === 0 ? "✅ CONTENT SCOPE: VALIDATED" : "❌ CONTENT SCOPE: ISSUES FOUND"}\n`);
process.exit(failed > 0 ? 1 : 0);
