/**
 * PYQ repository.
 * Data access layer for the pyqs table.
 *
 * Phase 2E: Supports keyword-based search, subject filtering,
 * and year-range queries for the shared PYQ bank.
 */

import { eq, desc, sql, ilike, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { pyqs } from "@/lib/db/schema";
import type { PYQ, NewPYQ } from "@/types/database.types";

export const pyqRepository = {
  async findById(id: string): Promise<PYQ | undefined> {
    const result = await db
      .select()
      .from(pyqs)
      .where(eq(pyqs.id, id))
      .limit(1);
    return result[0];
  },

  /**
   * Search PYQs by keyword overlap.
   * Uses array overlap (&&) to match any keyword.
   */
  async findByKeywords(keywords: string[], limit = 20): Promise<PYQ[]> {
    if (keywords.length === 0) return [];

    const lowerKeywords = keywords.map((k) => k.toLowerCase().trim());

    return db
      .select()
      .from(pyqs)
      .where(
        sql`${pyqs.keywords} && ${sql`ARRAY[${sql.join(
          lowerKeywords.map((k) => sql`${k}`),
          sql`, `
        )}]::text[]`}`
      )
      .orderBy(desc(pyqs.year))
      .limit(limit);
  },

  /**
   * Find PYQs by subject.
   */
  async findBySubject(subject: string, limit = 20): Promise<PYQ[]> {
    return db
      .select()
      .from(pyqs)
      .where(ilike(pyqs.subject, `%${subject}%`))
      .orderBy(desc(pyqs.year))
      .limit(limit);
  },

  /**
   * Full-text search on question content.
   */
  async searchByQuestion(query: string, limit = 10): Promise<PYQ[]> {
    return db
      .select()
      .from(pyqs)
      .where(ilike(pyqs.question, `%${query}%`))
      .orderBy(desc(pyqs.year))
      .limit(limit);
  },

  /**
   * Get all PYQs (for matching pipeline).
   */
  async findAll(limit = 200): Promise<PYQ[]> {
    return db
      .select()
      .from(pyqs)
      .orderBy(desc(pyqs.year))
      .limit(limit);
  },

  /**
   * Insert PYQs (seed/admin use).
   */
  async createMany(data: NewPYQ[]): Promise<PYQ[]> {
    if (data.length === 0) return [];
    return db.insert(pyqs).values(data).returning();
  },
};
