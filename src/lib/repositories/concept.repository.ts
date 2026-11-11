/**
 * Concept repository.
 * Data access layer for the concepts table.
 * 
 * Phase 2B: Added normalized-name queries, existing-name lookup
 * for deduplication, and conflict-safe batch insert.
 */

import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { concepts } from "@/lib/db/schema";
import type { Concept, NewConcept } from "@/types/database.types";

export const conceptRepository = {
  async findById(id: string): Promise<Concept | undefined> {
    const result = await db
      .select()
      .from(concepts)
      .where(eq(concepts.id, id))
      .limit(1);

    return result[0];
  },

  /**
   * Batch find concepts by IDs (eliminates N+1 queries).
   */
  async findByIds(ids: string[]): Promise<Concept[]> {
    if (ids.length === 0) return [];
    return db
      .select()
      .from(concepts)
      .where(inArray(concepts.id, ids));
  },

  async findByDailyLog(
    dailyLogId: string,
    userId: string
  ): Promise<Concept[]> {
    return db
      .select()
      .from(concepts)
      .where(
        and(
          eq(concepts.dailyLogId, dailyLogId),
          eq(concepts.userId, userId)
        )
      )
      .orderBy(desc(concepts.extractionConfidence));
  },

  async findByUser(userId: string, limit = 50): Promise<Concept[]> {
    return db
      .select()
      .from(concepts)
      .where(eq(concepts.userId, userId))
      .orderBy(desc(concepts.createdAt))
      .limit(limit);
  },

  /** Newspaper-sourced concepts for a user, newest first. Optional edition/page filter. */
  async findNewspaperConcepts(
    userId: string,
    filter: {
      newspaper?: string;
      editionDate?: string;
      pageNumber?: number;
      /** Inclusive ISO date range on the edition date. */
      editionFrom?: string;
      editionTo?: string;
      /** Concepts belonging to these story threads (a concept without a storyId is its own story). */
      storyIds?: string[];
    } = {},
    limit = 300
  ): Promise<Concept[]> {
    if (filter.storyIds && filter.storyIds.length === 0) return [];
    const conds = [
      eq(concepts.userId, userId),
      sql`${concepts.extractionMetadata}->>'source' = 'newspaper'`,
    ];
    if (filter.newspaper) conds.push(sql`${concepts.extractionMetadata}->>'newspaper' = ${filter.newspaper}`);
    if (filter.editionDate) conds.push(sql`${concepts.extractionMetadata}->>'editionDate' = ${filter.editionDate}`);
    if (typeof filter.pageNumber === "number") conds.push(sql`(${concepts.extractionMetadata}->>'pageNumber')::int = ${filter.pageNumber}`);
    // ISO dates compare correctly as text.
    if (filter.editionFrom) conds.push(sql`${concepts.extractionMetadata}->>'editionDate' >= ${filter.editionFrom}`);
    if (filter.editionTo) conds.push(sql`${concepts.extractionMetadata}->>'editionDate' <= ${filter.editionTo}`);
    if (filter.storyIds) {
      conds.push(
        sql`coalesce(${concepts.extractionMetadata}->>'storyId', ${concepts.id}::text) in (${sql.join(
          filter.storyIds.map((s) => sql`${s}`),
          sql`, `
        )})`
      );
    }
    return db
      .select()
      .from(concepts)
      .where(and(...conds))
      .orderBy(desc(concepts.createdAt))
      .limit(limit);
  },

  /**
   * Get ALL concepts for a user (no limit), ordered oldest-first.
   * Used exclusively by hydration/backfill — NOT for frontend queries.
   */
  async findAllByUser(userId: string): Promise<Concept[]> {
    return db
      .select()
      .from(concepts)
      .where(eq(concepts.userId, userId))
      .orderBy(concepts.createdAt); // oldest first for hydration
  },

  /**
   * Lightweight count of total concepts for a user.
   * Uses index-only scan on concepts_user_id_idx.
   * Audit 2 remediation — avoids loading all rows just to count.
   */
  async countByUser(userId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(concepts)
      .where(eq(concepts.userId, userId));
    return Number(result[0]?.count ?? 0);
  },

  async findBySubject(
    userId: string,
    subject: string
  ): Promise<Concept[]> {
    return db
      .select()
      .from(concepts)
      .where(
        and(
          eq(concepts.userId, userId),
          eq(concepts.subject, subject)
        )
      )
      .orderBy(desc(concepts.createdAt));
  },

  /**
   * Get the set of existing normalized_name::subject keys for a user + daily log.
   * Used by the deduplication pipeline to avoid re-inserting existing concepts.
   */
  async getExistingNormalizedKeys(
    dailyLogId: string,
    userId: string
  ): Promise<Set<string>> {
    const rows = await db
      .select({
        normalizedName: concepts.normalizedName,
        subject: concepts.subject,
      })
      .from(concepts)
      .where(
        and(
          eq(concepts.dailyLogId, dailyLogId),
          eq(concepts.userId, userId)
        )
      );

    return new Set(
      rows.map((r) => `${r.normalizedName}::${r.subject.toLowerCase()}`)
    );
  },

  /**
   * Batch insert concepts with conflict handling.
   * If a duplicate (user_id, daily_log_id, normalized_name, subject) is hit,
   * the conflicting row is silently skipped.
   */
  async createMany(data: NewConcept[]): Promise<Concept[]> {
    if (data.length === 0) return [];

    return db
      .insert(concepts)
      .values(data)
      .onConflictDoNothing({
        target: [
          concepts.userId,
          concepts.dailyLogId,
          concepts.normalizedName,
          concepts.subject,
        ],
      })
      .returning();
  },

  async deleteByDailyLog(
    dailyLogId: string,
    userId: string
  ): Promise<number> {
    const result = await db
      .delete(concepts)
      .where(
        and(
          eq(concepts.dailyLogId, dailyLogId),
          eq(concepts.userId, userId),
          // Newspaper concepts share the day's log but are not extracted from
          // its text; re-extracting the log must never delete them.
          sql`coalesce(${concepts.extractionMetadata}->>'source', '') <> 'newspaper'`
        )
      )
      .returning({ id: concepts.id });

    return result.length;
  },
};
