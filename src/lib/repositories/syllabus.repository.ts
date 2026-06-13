/**
 * Syllabus ontology repository.
 * Retrieval utilities for the UPSC syllabus ontology.
 *
 * Phase 2G: Provides type-safe access to GS papers, domains, subtopics,
 * and their hierarchical relationships.
 *
 * Future consumers: GS mapping, AI grounding, PYQ intelligence, revision planning.
 */

import { eq, desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { gsPapers, syllabusDomains, syllabusSubtopics, conceptSyllabusLinks } from "@/lib/db/schema";
import type {
  GsPaperRecord,
  SyllabusDomainRecord,
  SyllabusSubtopicRecord,
  ConceptSyllabusLinkRecord,
  NewConceptSyllabusLinkRecord,
} from "@/types/database.types";

// ─── Enriched types for hierarchical queries ────────────────

export interface DomainWithSubtopics extends SyllabusDomainRecord {
  subtopics: SyllabusSubtopicRecord[];
}

export interface PaperWithDomains extends GsPaperRecord {
  domains: DomainWithSubtopics[];
}

/** Flattened ontology node for quick lookup. */
export interface FlatOntologyNode {
  paperId: string;
  paperCode: string;
  domainId: string;
  domainName: string;
  subtopicId: string;
  subtopicName: string;
}

export const syllabusRepository = {
  // ─── GS Papers ──────────────────────────────────────────

  async getAllPapers(): Promise<GsPaperRecord[]> {
    return db.select().from(gsPapers).orderBy(gsPapers.code);
  },

  async getPaperByCode(code: string): Promise<GsPaperRecord | undefined> {
    const result = await db
      .select()
      .from(gsPapers)
      .where(eq(gsPapers.code, code))
      .limit(1);
    return result[0];
  },

  // ─── Syllabus Domains ───────────────────────────────────

  async getDomainsByPaper(paperId: string): Promise<SyllabusDomainRecord[]> {
    return db
      .select()
      .from(syllabusDomains)
      .where(eq(syllabusDomains.paperId, paperId))
      .orderBy(syllabusDomains.name);
  },

  async getAllDomains(): Promise<SyllabusDomainRecord[]> {
    return db
      .select()
      .from(syllabusDomains)
      .orderBy(syllabusDomains.name);
  },

  // ─── Syllabus Subtopics ─────────────────────────────────

  async getSubtopicsByDomain(domainId: string): Promise<SyllabusSubtopicRecord[]> {
    return db
      .select()
      .from(syllabusSubtopics)
      .where(eq(syllabusSubtopics.domainId, domainId))
      .orderBy(syllabusSubtopics.name);
  },

  async getAllSubtopics(): Promise<SyllabusSubtopicRecord[]> {
    return db
      .select()
      .from(syllabusSubtopics)
      .orderBy(syllabusSubtopics.name);
  },

  // ─── Hierarchical Queries ───────────────────────────────

  /**
   * Get full ontology for a GS paper: paper → domains → subtopics.
   */
  async getPaperHierarchy(paperCode: string): Promise<PaperWithDomains | null> {
    const paper = await this.getPaperByCode(paperCode);
    if (!paper) return null;

    const domains = await this.getDomainsByPaper(paper.id);

    const domainsWithSubtopics: DomainWithSubtopics[] = [];
    for (const domain of domains) {
      const subtopics = await this.getSubtopicsByDomain(domain.id);
      domainsWithSubtopics.push({ ...domain, subtopics });
    }

    return { ...paper, domains: domainsWithSubtopics };
  },

  /**
   * Flatten the entire ontology into a flat array of nodes.
   * Useful for search, matching, and AI grounding context.
   */
  async getFlatOntology(): Promise<FlatOntologyNode[]> {
    const papers = await this.getAllPapers();
    const nodes: FlatOntologyNode[] = [];

    for (const paper of papers) {
      const domains = await this.getDomainsByPaper(paper.id);
      for (const domain of domains) {
        const subtopics = await this.getSubtopicsByDomain(domain.id);
        for (const subtopic of subtopics) {
          nodes.push({
            paperId: paper.id,
            paperCode: paper.code,
            domainId: domain.id,
            domainName: domain.name,
            subtopicId: subtopic.id,
            subtopicName: subtopic.name,
          });
        }
      }
    }

    return nodes;
  },

  // ─── Concept ↔ Syllabus Links ──────────────────────────

  async getLinksByConcept(conceptId: string): Promise<ConceptSyllabusLinkRecord[]> {
    return db
      .select()
      .from(conceptSyllabusLinks)
      .where(eq(conceptSyllabusLinks.conceptId, conceptId))
      .orderBy(desc(conceptSyllabusLinks.confidenceScore));
  },

  async createLinks(data: NewConceptSyllabusLinkRecord[]): Promise<ConceptSyllabusLinkRecord[]> {
    if (data.length === 0) return [];
    return db
      .insert(conceptSyllabusLinks)
      .values(data)
      .onConflictDoNothing({
        target: [conceptSyllabusLinks.conceptId, conceptSyllabusLinks.subtopicId],
      })
      .returning();
  },

  async deleteLinksByConcept(conceptId: string): Promise<number> {
    const result = await db
      .delete(conceptSyllabusLinks)
      .where(eq(conceptSyllabusLinks.conceptId, conceptId))
      .returning({ id: conceptSyllabusLinks.id });
    return result.length;
  },

  // ─── Validation Helpers ─────────────────────────────────

  /**
   * Check if the ontology has been seeded.
   */
  async isSeeded(): Promise<boolean> {
    const papers = await db
      .select({ id: gsPapers.id })
      .from(gsPapers)
      .limit(1);
    return papers.length > 0;
  },

  /**
   * Get ontology stats (for observability).
   */
  async getStats(): Promise<{ papers: number; domains: number; subtopics: number }> {
    const papers = await db.select({ id: gsPapers.id }).from(gsPapers);
    const domains = await db.select({ id: syllabusDomains.id }).from(syllabusDomains);
    const subtopics = await db.select({ id: syllabusSubtopics.id }).from(syllabusSubtopics);

    return {
      papers: papers.length,
      domains: domains.length,
      subtopics: subtopics.length,
    };
  },
};
