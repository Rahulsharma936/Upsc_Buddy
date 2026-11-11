/**
 * Bring every question inventory up to the current standard (3b.2, audited).
 *
 * Per row:
 *   - version < 3b.2, or no MCQs        → regenerate (force) — generation + audit
 *   - version 3b.2 but not audited      → audit-only: independent solve, drop
 *                                          disagreements, mark audited
 *   - already 3b.2 and audited          → skipped
 *
 * Safety:
 *   - Every target row is written to a JSON backup BEFORE anything changes.
 *   - Paced for Groq's 8,000 tokens/min limit (~1 regeneration per minute).
 *   - If a regeneration throws, yields fewer MCQs than before, or is left
 *     unaudited, the old row is restored exactly.
 *
 * Usage (repo root):
 *   npx tsx scripts/regenerate-questions.ts --backup <file.json> [--dry-run]
 *   npx tsx scripts/regenerate-questions.ts --restore <file.json>
 */

import { readFileSync, writeFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (line.trim().startsWith("#")) continue;
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const DRY = args.includes("--dry-run");
const CURRENT = "3b.2";
const BACKUP = arg("--backup");
const RESTORE = arg("--restore");
const PAUSE_AFTER_REGEN_MS = 62_000;
const PAUSE_AFTER_AUDIT_MS = 25_000;

interface BackupRow {
  conceptId: string;
  userId: string;
  name: string;
  subject: string;
  prelimsMcqs: unknown[];
  mainsQuestions: unknown[];
  interviewPrompts: unknown[];
  generationConfidence: string;
  generationMetadata: Record<string, unknown>;
}

type Action = "regenerate" | "audit";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const versionLess = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true }) < 0;

function actionFor(b: BackupRow): Action | null {
  const version = String(b.generationMetadata?.version ?? "0");
  if (versionLess(version, CURRENT) || b.prelimsMcqs.length === 0) return "regenerate";
  if (b.generationMetadata?.audited !== true) return "audit";
  return null;
}

async function main() {
  const { db } = await import("@/lib/db");
  const { concepts, conceptQuestions } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const { conceptQuestionsRepository } = await import("@/lib/repositories/concept-questions.repository");
  const { questionIntelligenceService } = await import("@/lib/ai/services/question-intelligence.service");
  const { auditMcqKeys } = await import("@/lib/ai/services/mcq-audit");

  const restoreRow = (b: BackupRow) =>
    conceptQuestionsRepository.upsert({
      conceptId: b.conceptId,
      prelimsMcqs: b.prelimsMcqs,
      mainsQuestions: b.mainsQuestions,
      interviewPrompts: b.interviewPrompts,
      generationConfidence: b.generationConfidence,
      generationMetadata: b.generationMetadata,
    });

  if (RESTORE) {
    const rows = JSON.parse(readFileSync(RESTORE, "utf8")) as BackupRow[];
    for (const b of rows) await restoreRow(b);
    console.log(`Restored ${rows.length} rows from ${RESTORE}`);
    process.exit(0);
  }
  if (!BACKUP) throw new Error("--backup <file.json> is required");

  const all = await db
    .select({ q: conceptQuestions, userId: concepts.userId, name: concepts.displayName, subject: concepts.subject })
    .from(conceptQuestions)
    .innerJoin(concepts, eq(concepts.id, conceptQuestions.conceptId));

  const rows: BackupRow[] = all.map((r) => ({
    conceptId: r.q.conceptId,
    userId: r.userId,
    name: r.name,
    subject: r.subject,
    prelimsMcqs: (r.q.prelimsMcqs as unknown[]) ?? [],
    mainsQuestions: (r.q.mainsQuestions as unknown[]) ?? [],
    interviewPrompts: (r.q.interviewPrompts as unknown[]) ?? [],
    generationConfidence: String(r.q.generationConfidence),
    generationMetadata: (r.q.generationMetadata as Record<string, unknown>) ?? {},
  }));
  const targets = rows.map((b) => ({ b, action: actionFor(b) })).filter((t): t is { b: BackupRow; action: Action } => t.action !== null);

  writeFileSync(BACKUP, JSON.stringify(targets.map((t) => t.b), null, 2));
  console.log(`Backed up ${targets.length} rows to ${BACKUP}: ${targets.filter((t) => t.action === "regenerate").length} to regenerate, ${targets.filter((t) => t.action === "audit").length} to audit`);
  if (DRY) { console.log("Dry run — nothing changed."); process.exit(0); }

  const summary: Array<{ name: string; before: string; after: string; status: string }> = [];
  for (const [i, { b, action }] of targets.entries()) {
    const before = `P${b.prelimsMcqs.length} M${b.mainsQuestions.length}`;
    process.stdout.write(`[${i + 1}/${targets.length}] ${action.padEnd(10)} ${b.name} ${before} → `);

    if (action === "audit") {
      const audit = await auditMcqKeys(b.prelimsMcqs as Array<{ question: string; options: { a: string; b: string; c: string; d: string }; correctAnswer: string }>);
      if (!audit.audited) {
        summary.push({ name: b.name, before, after: before, status: "UNCHANGED (audit failed)" });
        console.log("audit failed, unchanged");
      } else if (audit.kept.length === 0) {
        // Every question failed the audit: regenerate instead of leaving it empty.
        targets.push({ b: { ...b, prelimsMcqs: [] }, action: "regenerate" });
        summary.push({ name: b.name, before, after: "queued", status: "all failed audit → regenerate" });
        console.log("all MCQs failed audit, queued for regeneration");
      } else {
        await conceptQuestionsRepository.upsert({
          conceptId: b.conceptId,
          prelimsMcqs: audit.kept,
          mainsQuestions: b.mainsQuestions,
          interviewPrompts: b.interviewPrompts,
          generationConfidence: b.generationConfidence,
          generationMetadata: { ...b.generationMetadata, audited: true, auditDropped: audit.dropped.length },
        });
        const after = `P${audit.kept.length} M${b.mainsQuestions.length}`;
        summary.push({ name: b.name, before, after, status: `audited (-${audit.dropped.length})` });
        console.log(`${after} audited, dropped ${audit.dropped.length}`);
      }
      if (i < targets.length - 1) await sleep(PAUSE_AFTER_AUDIT_MS);
      continue;
    }

    try {
      const res = await questionIntelligenceService.generate({ conceptId: b.conceptId, userId: b.userId, force: true });
      const meta = (res.questions.generationMetadata ?? {}) as Record<string, unknown>;
      const after = `P${res.stats.prelimsCount} M${res.stats.mainsCount}`;
      if (res.stats.prelimsCount === 0 || res.stats.prelimsCount < b.prelimsMcqs.length || meta.audited !== true) {
        await restoreRow(b);
        const why = res.stats.prelimsCount === 0 ? "no MCQs" : meta.audited !== true ? "unaudited" : "fewer MCQs";
        summary.push({ name: b.name, before, after, status: `RESTORED (${why})` });
        console.log(`${after} — ${why}, old row restored`);
      } else {
        summary.push({ name: b.name, before, after, status: `regenerated (-${meta.auditDropped ?? 0})` });
        console.log(`${after} ✓ audited, dropped ${meta.auditDropped ?? 0}`);
      }
    } catch (err) {
      await restoreRow(b).catch(() => undefined);
      const msg = err instanceof Error ? err.message.slice(0, 120) : String(err);
      summary.push({ name: b.name, before, after: "-", status: `RESTORED (error)` });
      console.log(`error, old row restored: ${msg}`);
    }
    if (i < targets.length - 1) await sleep(PAUSE_AFTER_REGEN_MS);
  }

  console.log(`\nSUMMARY`);
  for (const s of summary) console.log(`  ${s.status.padEnd(30)} ${s.before} → ${s.after}  ${s.name}`);
  process.exit(0);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(2); });
