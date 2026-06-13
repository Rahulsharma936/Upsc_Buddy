/**
 * GS Mapping Engine — Phase 3A.
 *
 * Deterministic mapping of concepts to UPSC syllabus ontology.
 * NO AI involved — purely algorithmic using ontology helpers.
 *
 * Flow:
 * 1. Resolve subject → GS paper(s)
 * 2. Find candidate subtopics by keyword matching
 * 3. Score each candidate
 * 4. Return ranked mappings with confidence
 *
 * Anti-hallucination: candidates ONLY come from the ontology.
 * The engine never invents syllabus entries.
 */

import {
  resolvePapersForSubject,
  findSubtopicsByKeywords,
  findSubtopicsByKeyword,
  getDomainsForPaper,
  type GsPaper,
  type SyllabusNode,
} from "@/lib/ontology";
import type { Concept } from "@/types/database.types";

/** A scored GS mapping candidate. */
export interface GSMapping {
  paper: GsPaper;
  domain: string;
  subtopic: string;
  confidence: number;
  reason: string;
}

/** Result of GS mapping for a concept. */
export interface GSMappingResult {
  primaryPaper: GsPaper;
  mappings: GSMapping[];
  mappingConfidence: number;
  stats: {
    candidatesEvaluated: number;
    mappingsAccepted: number;
    mappingsRejected: number;
  };
}

/** Minimum score for a mapping to be accepted. */
const MIN_MAPPING_SCORE = 0.25;

/** Maximum mappings to return per concept. */
const MAX_MAPPINGS = 6;

/**
 * Map a concept to GS papers/domains/subtopics using the ontology.
 * Fully deterministic — no AI calls.
 */
export function mapConceptToSyllabus(concept: Concept): GSMappingResult {
  const stats = {
    candidatesEvaluated: 0,
    mappingsAccepted: 0,
    mappingsRejected: 0,
  };

  // ─── Step 1: Resolve primary GS paper ──────────────────
  const papers = resolvePapersForSubject(concept.subject);
  const primaryPaper: GsPaper = papers.length > 0 ? papers[0] : "GS1";

  // ─── Step 2: Generate candidate subtopics ──────────────
  const keywords = (concept.keywords ?? []).map((k) => k.toLowerCase().trim());
  const conceptName = concept.normalizedName.toLowerCase();

  // Search by concept name + keywords
  const searchTerms = [conceptName, ...keywords];
  const candidateNodes = findSubtopicsByKeywords(searchTerms);

  // Also search by concept display name words
  const nameWords = concept.displayName
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .map((w) => w.toLowerCase());

  for (const word of nameWords) {
    const wordMatches = findSubtopicsByKeyword(word);
    for (const node of wordMatches) {
      const key = `${node.paper}::${node.domain}::${node.subtopic}`;
      if (!candidateNodes.some((c) => `${c.paper}::${c.domain}::${c.subtopic}` === key)) {
        candidateNodes.push(node);
      }
    }
  }

  // ─── Step 3: Score each candidate ──────────────────────
  const scored: GSMapping[] = [];

  for (const node of candidateNodes) {
    stats.candidatesEvaluated++;
    const score = scoreCandidate(concept, node, primaryPaper);

    if (score >= MIN_MAPPING_SCORE) {
      scored.push({
        paper: node.paper as GsPaper,
        domain: node.domain,
        subtopic: node.subtopic,
        confidence: score,
        reason: buildMappingReason(concept, node, score),
      });
      stats.mappingsAccepted++;
    } else {
      stats.mappingsRejected++;
    }
  }

  // ─── Step 4: Rank and cap ──────────────────────────────
  scored.sort((a, b) => b.confidence - a.confidence);
  const topMappings = scored.slice(0, MAX_MAPPINGS);

  // ─── Overall mapping confidence ────────────────────────
  const mappingConfidence = topMappings.length > 0
    ? Math.round(topMappings.reduce((sum, m) => sum + m.confidence, 0) / topMappings.length * 100) / 100
    : 0.3; // Base confidence even with no ontology matches

  return {
    primaryPaper,
    mappings: topMappings,
    mappingConfidence,
    stats,
  };
}

// ─── Scoring ────────────────────────────────────────────────

function scoreCandidate(concept: Concept, node: SyllabusNode, primaryPaper: GsPaper): number {
  let score = 0;
  const conceptName = concept.normalizedName.toLowerCase();
  const conceptKeywords = (concept.keywords ?? []).map((k) => k.toLowerCase().trim());
  const subtopicLower = node.subtopic.toLowerCase();
  const domainLower = node.domain.toLowerCase();

  // Signal 1: Concept name matches subtopic name (strongest)
  if (subtopicLower.includes(conceptName) || conceptName.includes(subtopicLower)) {
    score += 0.40;
  } else {
    // Partial word overlap
    const nameWords = conceptName.split(/\s+/).filter((w) => w.length > 2);
    let hits = 0;
    for (const word of nameWords) {
      if (subtopicLower.includes(word)) hits++;
    }
    if (nameWords.length > 0) {
      score += (hits / nameWords.length) * 0.20;
    }
  }

  // Signal 2: Keyword overlap with subtopic name
  for (const kw of conceptKeywords) {
    if (subtopicLower.includes(kw) || kw.includes(subtopicLower)) {
      score += 0.10;
      break; // One hit is enough for this signal
    }
  }

  // Signal 3: Paper alignment
  if (node.paper === primaryPaper) {
    score += 0.15;
  }

  // Signal 4: Domain name relevance
  const domainWords = domainLower.replace(/([A-Z])/g, " $1").toLowerCase().split(/\s+/);
  for (const dw of domainWords) {
    if (dw.length > 3 && (conceptName.includes(dw) || conceptKeywords.includes(dw))) {
      score += 0.08;
      break;
    }
  }

  // Signal 5: Keyword matches domain
  for (const kw of conceptKeywords) {
    if (domainLower.includes(kw.replace(/\s+/g, ""))) {
      score += 0.05;
      break;
    }
  }

  return Math.round(Math.min(score, 0.95) * 100) / 100;
}

function buildMappingReason(concept: Concept, node: SyllabusNode, score: number): string {
  const parts: string[] = [];

  if (node.subtopic.toLowerCase().includes(concept.normalizedName.toLowerCase())) {
    parts.push(`Concept directly maps to syllabus subtopic "${node.subtopic}"`);
  } else {
    parts.push(`Thematic overlap with "${node.subtopic}" under ${node.domain}`);
  }

  parts.push(`${node.paper} — ${node.domain}`);

  return parts.join(". ") + ".";
}
