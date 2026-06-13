/**
 * Ontology query helpers.
 *
 * Lightweight, pure-function utilities for querying and validating
 * the UPSC syllabus ontology from the static seed data.
 *
 * Use these for:
 * - In-process ontology lookups (no DB round-trip)
 * - Validation of paper/domain/subtopic combinations
 * - Building AI grounding context
 * - Subject → GS paper resolution
 *
 * For DB-backed queries, use syllabus.repository.ts.
 */

import { upscSyllabus, flattenSyllabus, type GsPaper, type SyllabusNode } from "@/lib/db/seeds/seeds";

// ─── Static ontology (computed once) ─────────────────────────

let _flatCache: SyllabusNode[] | null = null;

function getFlat(): SyllabusNode[] {
  if (!_flatCache) _flatCache = flattenSyllabus();
  return _flatCache;
}

// ─── Paper Queries ───────────────────────────────────────────

/** All valid GS paper codes. */
export const GS_PAPER_CODES: GsPaper[] = Object.keys(upscSyllabus) as GsPaper[];

/** Check if a string is a valid GS paper code. */
export function isValidPaper(code: string): code is GsPaper {
  return GS_PAPER_CODES.includes(code as GsPaper);
}

/** Get all domain names for a paper. */
export function getDomainsForPaper(paper: GsPaper): string[] {
  return Object.keys(upscSyllabus[paper]);
}

/** Get all subtopics for a paper + domain. */
export function getSubtopicsForDomain(paper: GsPaper, domain: string): readonly string[] {
  const domains = upscSyllabus[paper] as Record<string, readonly string[]>;
  return domains[domain] ?? [];
}

// ─── Subject → Paper Resolution ─────────────────────────────

/**
 * Map a concept subject (from the extraction pipeline) to likely GS paper(s).
 * Returns papers in priority order.
 *
 * This is the bridge between the concept extraction subject taxonomy
 * and the official UPSC syllabus ontology.
 */
const SUBJECT_TO_PAPERS: Record<string, GsPaper[]> = {
  // GS1
  "Indian Heritage & Culture": ["GS1"],
  "History": ["GS1"],
  "Geography": ["GS1"],
  "Indian Society": ["GS1"],

  // GS2
  "Polity": ["GS2"],
  "Governance": ["GS2"],
  "Social Justice": ["GS2"],
  "International Relations": ["GS2"],

  // GS3
  "Economy": ["GS3"],
  "Science & Technology": ["GS3"],
  "Environment & Ecology": ["GS3"],
  "Internal Security": ["GS3"],

  // GS4
  "Ethics": ["GS4"],

  // Cross-paper
  "Current Affairs": ["GS2", "GS3"],
};

export function resolvePapersForSubject(subject: string): GsPaper[] {
  return SUBJECT_TO_PAPERS[subject] ?? [];
}

// ─── Subtopic Search ─────────────────────────────────────────

/**
 * Find subtopics matching a keyword (case-insensitive partial match).
 * Useful for deterministic concept → syllabus mapping.
 */
export function findSubtopicsByKeyword(keyword: string): SyllabusNode[] {
  const lower = keyword.toLowerCase().trim();
  if (lower.length < 3) return [];

  return getFlat().filter((node) =>
    node.subtopic.toLowerCase().includes(lower)
  );
}

/**
 * Find subtopics matching ANY of multiple keywords.
 * Returns unique nodes (deduped by subtopic name).
 */
export function findSubtopicsByKeywords(keywords: string[]): SyllabusNode[] {
  const seen = new Set<string>();
  const results: SyllabusNode[] = [];

  for (const kw of keywords) {
    for (const node of findSubtopicsByKeyword(kw)) {
      const key = `${node.paper}::${node.domain}::${node.subtopic}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(node);
      }
    }
  }

  return results;
}

// ─── Validation ──────────────────────────────────────────────

/**
 * Validate a (paper, domain, subtopic) triple against the ontology.
 */
export function isValidOntologyPath(paper: string, domain: string, subtopic: string): boolean {
  if (!isValidPaper(paper)) return false;
  const subtopics = getSubtopicsForDomain(paper, domain);
  return subtopics.includes(subtopic);
}

// ─── Stats ───────────────────────────────────────────────────

/**
 * Get static ontology stats (no DB round-trip).
 */
export function getOntologyStats(): {
  papers: number;
  domains: number;
  subtopics: number;
} {
  const flat = getFlat();
  const papers = new Set(flat.map((n) => n.paper));
  const domains = new Set(flat.map((n) => `${n.paper}::${n.domain}`));

  return {
    papers: papers.size,
    domains: domains.size,
    subtopics: flat.length,
  };
}
