/**
 * AI notes repository.
 * Data access layer for the ai_notes table.
 * 
 * Phase 2C: Supports versioned notes, latest-version retrieval,
 * content-hash dedup, and conflict-safe inserts.
 */

import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiNotes } from "@/lib/db/schema";
import type { AINoteRecord, NewAINoteRecord } from "@/types/database.types";

export const noteRepository = {
  /**
   * Find a note by ID.
   */
  async findById(id: string): Promise<AINoteRecord | undefined> {
    const result = await db
      .select()
      .from(aiNotes)
      .where(eq(aiNotes.id, id))
      .limit(1);

    return result[0];
  },

  /**
   * Get the latest version of a note for a concept.
   */
  async findLatestByConceptId(
    conceptId: string
  ): Promise<AINoteRecord | undefined> {
    const result = await db
      .select()
      .from(aiNotes)
      .where(eq(aiNotes.conceptId, conceptId))
      .orderBy(desc(aiNotes.version))
      .limit(1);

    return result[0];
  },

  /**
   * Get all versions of notes for a concept (newest first).
   */
  async findAllVersionsByConceptId(
    conceptId: string
  ): Promise<AINoteRecord[]> {
    return db
      .select()
      .from(aiNotes)
      .where(eq(aiNotes.conceptId, conceptId))
      .orderBy(desc(aiNotes.version));
  },

  /**
   * Get the next version number for a concept.
   */
  async getNextVersion(conceptId: string): Promise<number> {
    const result = await db
      .select({ maxVersion: sql<number>`COALESCE(MAX(${aiNotes.version}), 0)` })
      .from(aiNotes)
      .where(eq(aiNotes.conceptId, conceptId));

    return (result[0]?.maxVersion ?? 0) + 1;
  },

  /**
   * Check if a note with the same content hash already exists.
   * Returns true if a duplicate is found (skip regeneration).
   */
  async existsByContentHash(
    conceptId: string,
    contentHash: string
  ): Promise<boolean> {
    const result = await db
      .select({ id: aiNotes.id })
      .from(aiNotes)
      .where(
        and(
          eq(aiNotes.conceptId, conceptId),
          eq(aiNotes.contentHash, contentHash)
        )
      )
      .limit(1);

    return result.length > 0;
  },

  /**
   * Create a new note version.
   * Uses onConflictDoNothing for concept_id + version uniqueness.
   */
  async create(data: NewAINoteRecord): Promise<AINoteRecord> {
    const result = await db
      .insert(aiNotes)
      .values(data)
      .onConflictDoNothing({
        target: [aiNotes.conceptId, aiNotes.version],
      })
      .returning();

    if (result.length === 0) {
      // Conflict hit — return the existing version
      const existing = await this.findLatestByConceptId(data.conceptId);
      if (!existing) throw new Error("Note creation conflict but no existing note found");
      return existing;
    }

    return result[0];
  },

  /**
   * Get latest notes for multiple concepts at once (batch).
   * Returns a Map of conceptId → latest note.
   */
  async findLatestForConcepts(
    conceptIds: string[]
  ): Promise<Map<string, AINoteRecord>> {
    if (conceptIds.length === 0) return new Map();

    // Fetch all notes for these concepts, ordered by version desc
    const rows = await db
      .select()
      .from(aiNotes)
      .where(inArray(aiNotes.conceptId, conceptIds))
      .orderBy(desc(aiNotes.version));

    // Keep only the latest version per concept (first seen = highest version)
    const map = new Map<string, AINoteRecord>();
    for (const row of rows) {
      if (!map.has(row.conceptId)) {
        map.set(row.conceptId, row);
      }
    }
    return map;
  },
};
