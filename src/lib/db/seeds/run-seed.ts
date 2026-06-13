/**
 * Syllabus ontology seed runner.
 * Reads the authoritative ontology from seeds.ts and inserts into DB.
 *
 * Guarantees:
 * - Idempotent: safe to run multiple times (ON CONFLICT DO NOTHING)
 * - Deterministic ordering: papers → domains → subtopics
 * - Full observability: logs every step, count, and failure
 * - Relational integrity: FK references resolved at runtime
 *
 * Usage: npx tsx src/lib/db/seeds/run-seed.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, and } from "drizzle-orm";
import { gsPapers } from "../schema/gs-papers";
import { syllabusDomains } from "../schema/syllabus-domains";
import { syllabusSubtopics } from "../schema/syllabus-subtopics";
import { upscSyllabus, type GsPaper } from "./seeds";

// ─── Load .env.local (tsx doesn't auto-load like Next.js) ───

function loadEnvFile() {
  const envPath = resolve(process.cwd(), ".env.local");
  try {
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
    console.log("[SEED] ✓ Loaded .env.local");
  } catch {
    console.log("[SEED] ⤳ No .env.local found, using existing env vars");
  }
}

loadEnvFile();

// ─── Paper metadata ─────────────────────────────────────────

const PAPER_TITLES: Record<GsPaper, string> = {
  GS1: "Indian Heritage, History, Geography & Society",
  GS2: "Governance, Constitution, Polity, Social Justice & IR",
  GS3: "Economy, Environment, Science & Technology, Security",
  GS4: "Ethics, Integrity & Aptitude",
  Essay: "Essay",
};

// ─── Seed runner ────────────────────────────────────────────

async function runSeed() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("[SEED] ✗ DATABASE_URL is not set");
    process.exit(1);
  }

  console.log("[SEED] ─────────────────────────────────────");
  console.log("[SEED] UPSC Syllabus Ontology Seeder");
  console.log("[SEED] ─────────────────────────────────────");

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  const stats = {
    papersInserted: 0,
    papersSkipped: 0,
    domainsInserted: 0,
    domainsSkipped: 0,
    subtopicsInserted: 0,
    subtopicsSkipped: 0,
    errors: 0,
  };

  try {
    // ─── Step 1: Seed GS papers ──────────────────────────
    console.log("[SEED] STEP 1: Seeding GS papers...");

    const paperIdMap = new Map<string, string>();

    for (const code of Object.keys(upscSyllabus) as GsPaper[]) {
      const title = PAPER_TITLES[code];

      try {
        const existing = await db
          .select({ id: gsPapers.id })
          .from(gsPapers)
          .where(eq(gsPapers.code, code))
          .limit(1);

        if (existing.length > 0) {
          paperIdMap.set(code, existing[0].id);
          stats.papersSkipped++;
          console.log(`[SEED]   ⤳ ${code}: already exists (${existing[0].id})`);
        } else {
          const inserted = await db
            .insert(gsPapers)
            .values({ code, title })
            .returning({ id: gsPapers.id });

          paperIdMap.set(code, inserted[0].id);
          stats.papersInserted++;
          console.log(`[SEED]   ✓ ${code}: inserted (${inserted[0].id})`);
        }
      } catch (err) {
        stats.errors++;
        console.error(`[SEED]   ✗ ${code}: FAILED —`, err instanceof Error ? err.message : err);
      }
    }

    console.log(`[SEED] Papers: ${stats.papersInserted} inserted, ${stats.papersSkipped} skipped`);

    // ─── Step 2: Seed domains ────────────────────────────
    console.log("[SEED] STEP 2: Seeding syllabus domains...");

    const domainIdMap = new Map<string, string>(); // "GS1::History" → uuid

    for (const [paperCode, domains] of Object.entries(upscSyllabus)) {
      const paperId = paperIdMap.get(paperCode);
      if (!paperId) {
        console.error(`[SEED]   ✗ No paper ID for ${paperCode} — skipping domains`);
        stats.errors++;
        continue;
      }

      for (const domainName of Object.keys(domains)) {
        const domainKey = `${paperCode}::${domainName}`;

        try {
          const existing = await db
            .select({ id: syllabusDomains.id })
            .from(syllabusDomains)
            .where(
              and(
                eq(syllabusDomains.paperId, paperId),
                eq(syllabusDomains.name, domainName)
              )
            )
            .limit(1);

          if (existing.length > 0) {
            domainIdMap.set(domainKey, existing[0].id);
            stats.domainsSkipped++;
          } else {
            const inserted = await db
              .insert(syllabusDomains)
              .values({ paperId, name: domainName })
              .returning({ id: syllabusDomains.id });

            domainIdMap.set(domainKey, inserted[0].id);
            stats.domainsInserted++;
            console.log(`[SEED]   ✓ ${domainKey}`);
          }
        } catch (err) {
          stats.errors++;
          console.error(`[SEED]   ✗ ${domainKey}: FAILED —`, err instanceof Error ? err.message : err);
        }
      }
    }

    console.log(`[SEED] Domains: ${stats.domainsInserted} inserted, ${stats.domainsSkipped} skipped`);

    // ─── Step 3: Seed subtopics ──────────────────────────
    console.log("[SEED] STEP 3: Seeding syllabus subtopics...");

    for (const [paperCode, domains] of Object.entries(upscSyllabus)) {
      const typedDomains = domains as Record<string, readonly string[]>;

      for (const [domainName, subtopics] of Object.entries(typedDomains)) {
        const domainKey = `${paperCode}::${domainName}`;
        const domainId = domainIdMap.get(domainKey);

        if (!domainId) {
          console.error(`[SEED]   ✗ No domain ID for ${domainKey} — skipping subtopics`);
          stats.errors++;
          continue;
        }

        for (const subtopicName of subtopics) {
          try {
            const existing = await db
              .select({ id: syllabusSubtopics.id })
              .from(syllabusSubtopics)
              .where(
                and(
                  eq(syllabusSubtopics.domainId, domainId),
                  eq(syllabusSubtopics.name, subtopicName)
                )
              )
              .limit(1);

            if (existing.length > 0) {
              stats.subtopicsSkipped++;
            } else {
              await db
                .insert(syllabusSubtopics)
                .values({ domainId, name: subtopicName });

              stats.subtopicsInserted++;
            }
          } catch (err) {
            stats.errors++;
            console.error(`[SEED]   ✗ ${domainKey} / ${subtopicName}: FAILED —`, err instanceof Error ? err.message : err);
          }
        }
      }
    }

    console.log(`[SEED] Subtopics: ${stats.subtopicsInserted} inserted, ${stats.subtopicsSkipped} skipped`);

    // ─── Summary ─────────────────────────────────────────
    console.log("[SEED] ─────────────────────────────────────");
    console.log("[SEED] ✓ Seed complete");
    console.log("[SEED] Summary:", JSON.stringify(stats, null, 2));
    console.log("[SEED] ─────────────────────────────────────");

    if (stats.errors > 0) {
      console.warn(`[SEED] ⚠ ${stats.errors} error(s) occurred during seeding`);
    }

  } catch (fatalErr) {
    console.error("[SEED] ✗ FATAL ERROR:", fatalErr);
    process.exit(1);
  } finally {
    await client.end();
    process.exit(stats.errors > 0 ? 1 : 0);
  }
}

runSeed();
