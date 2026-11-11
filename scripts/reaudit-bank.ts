/**
 * Re-audit the question bank with the second-family auditor (no main-model
 * tokens used), and remove questions verified wrong by hand.
 *
 * Every touched row is backed up first; restore with:
 *   npx tsx scripts/regenerate-questions.ts --restore <backup.json>
 *
 * Usage: npx tsx scripts/reaudit-bank.ts --backup <file.json> [--remove "Concept::question prefix" ...]
 */

import { readFileSync, writeFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (line.trim().startsWith("#")) continue;
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const args = process.argv.slice(2);
const BACKUP = args[args.indexOf("--backup") + 1];
const REMOVE: Array<{ concept: string; prefix: string }> = [];
args.forEach((a, i) => {
  if (a === "--remove") {
    const [concept, prefix] = args[i + 1].split("::");
    REMOVE.push({ concept, prefix });
  }
});
const PAUSE_MS = 8_000;

type Mcq = { question: string; options: { a: string; b: string; c: string; d: string }; correctAnswer: string };

async function main() {
  if (!BACKUP || BACKUP.startsWith("--")) throw new Error("--backup <file.json> is required");
  const { db } = await import("@/lib/db");
  const { concepts, conceptQuestions } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const { conceptQuestionsRepository } = await import("@/lib/repositories/concept-questions.repository");
  const { auditMcqKeys } = await import("@/lib/ai/services/mcq-audit");

  const all = await db
    .select({ q: conceptQuestions, userId: concepts.userId, name: concepts.displayName, subject: concepts.subject })
    .from(conceptQuestions)
    .innerJoin(concepts, eq(concepts.id, conceptQuestions.conceptId));
  const rows = all.filter((r) => (r.q.generationMetadata as Record<string, unknown>)?.version === "3b.2" && (r.q.prelimsMcqs as unknown[]).length > 0);

  writeFileSync(BACKUP, JSON.stringify(rows.map((r) => ({
    conceptId: r.q.conceptId, userId: r.userId, name: r.name, subject: r.subject,
    prelimsMcqs: r.q.prelimsMcqs, mainsQuestions: r.q.mainsQuestions, interviewPrompts: r.q.interviewPrompts,
    generationConfidence: String(r.q.generationConfidence), generationMetadata: r.q.generationMetadata,
  })), null, 2));
  console.log(`Backed up ${rows.length} rows to ${BACKUP}`);

  let removedByHand = 0;
  let droppedByAudit = 0;
  for (const [i, r] of rows.entries()) {
    let mcqs = r.q.prelimsMcqs as Mcq[];
    const before = mcqs.length;

    for (const rm of REMOVE.filter((x) => x.concept === r.name)) {
      const n = mcqs.length;
      mcqs = mcqs.filter((m) => !m.question.startsWith(rm.prefix));
      removedByHand += n - mcqs.length;
    }

    const audit = await auditMcqKeys(mcqs, { primary: false, secondary: true });
    const meta = r.q.generationMetadata as Record<string, unknown>;
    let status: string;
    if (!audit.audited) {
      status = "secondary audit unavailable — unchanged except hand removals";
    } else {
      droppedByAudit += audit.dropped.length;
      for (const d of audit.dropped) console.log(`    dropped: stated ${d.mcq.correctAnswer}, auditor ${d.verdict.answer}${d.verdict.flawed ? " (flawed)" : ""} — ${d.verdict.reason.slice(0, 140)}`);
      mcqs = audit.kept;
      status = `secondary audited, dropped ${audit.dropped.length}`;
    }

    await conceptQuestionsRepository.upsert({
      conceptId: r.q.conceptId,
      prelimsMcqs: mcqs,
      mainsQuestions: r.q.mainsQuestions,
      interviewPrompts: r.q.interviewPrompts,
      generationConfidence: String(r.q.generationConfidence),
      generationMetadata: {
        ...meta,
        ...(audit.audited ? { auditors: [...new Set([...(Array.isArray(meta.auditors) ? (meta.auditors as string[]) : ["primary"]), ...audit.auditors])] } : {}),
      },
    });
    console.log(`[${i + 1}/${rows.length}] ${r.name}: P${before} → P${mcqs.length} (${status})`);
    if (i < rows.length - 1) await new Promise((res) => setTimeout(res, PAUSE_MS));
  }
  console.log(`\nDONE: removed by hand ${removedByHand}, dropped by second auditor ${droppedByAudit}`);
  process.exit(0);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(2); });
