/**
 * PYQ matching service — Phase 2E.
 *
 * Pipeline:
 * Concept → Keyword/Subject matching against PYQ bank (deterministic) →
 * Score calibration → AI relevance explanation (optional) → Persistence
 *
 * CRITICAL: PYQs come ONLY from the database. The AI NEVER generates questions.
 * AI is used ONLY to explain WHY a match is relevant.
 */

import { pyqRepository } from "@/lib/repositories/pyq.repository";
import { pyqMatchRepository } from "@/lib/repositories/pyq-match.repository";
import { conceptRepository } from "@/lib/repositories/concept.repository";
import { createAILogger } from "@/lib/ai/utils/logger";
import type { PYQ, Concept } from "@/types/database.types";

const log = createAILogger("pyq-matching");

/** Minimum match score to persist. Calibrated for small PYQ bank (~25 questions). */
const MIN_MATCH_STRENGTH = 0.30;

/**
 * Calculate deterministic match score between a concept and a PYQ.
 * Uses keyword overlap, name matching, tag matching, and subject alignment.
 * NO AI involved — purely algorithmic.
 *
 * Scoring philosophy: Allow analytically defensible thematic relevance
 * while rejecting weak unrelated overlap.
 */
function calculateMatchScore(concept: Concept, pyq: PYQ): number {
  let score = 0;
  const conceptKeywords = (concept.keywords ?? []).map((k) => k.toLowerCase().trim());
  const conceptName = concept.normalizedName.toLowerCase();
  const conceptSubject = concept.subject.toLowerCase();

  const pyqKeywords = (pyq.keywords ?? []).map((k) => k.toLowerCase().trim());
  const pyqTags = (pyq.topicTags ?? []).map((t) => t.toLowerCase().trim());
  const pyqSubject = pyq.subject.toLowerCase();
  const pyqQuestion = pyq.question.toLowerCase();

  // ─── Signal 1: Keyword overlap (strongest signal) ──────
  let keywordHits = 0;
  for (const ck of conceptKeywords) {
    if (pyqKeywords.includes(ck)) keywordHits++;
  }
  // Normalize: max contribution 0.35
  const keywordScore = Math.min(keywordHits * 0.12, 0.35);
  score += keywordScore;

  // ─── Signal 2: Concept name in question text ───────────
  if (pyqQuestion.includes(conceptName)) {
    score += 0.25; // Strong direct match
  } else {
    // Partial name match (split concept name into words)
    const nameWords = conceptName.split(/\s+/).filter((w) => w.length > 2);
    let nameHits = 0;
    for (const word of nameWords) {
      if (pyqQuestion.includes(word)) nameHits++;
    }
    if (nameWords.length > 0) {
      score += (nameHits / nameWords.length) * 0.15;
    }
  }

  // ─── Signal 3: Concept name in PYQ keywords/tags ───────
  // Critical: "Fundamental Rights" as a concept should match a PYQ
  // that has "fundamental rights" in its keywords or tags.
  if (pyqKeywords.includes(conceptName) || pyqTags.includes(conceptName)) {
    score += 0.20;
  } else {
    // Check if concept name words appear in tags/keywords
    const nameWords = conceptName.split(/\s+/).filter((w) => w.length > 2);
    let tagHits = 0;
    for (const word of nameWords) {
      if (pyqTags.some((t) => t.includes(word)) || pyqKeywords.some((k) => k.includes(word))) {
        tagHits++;
      }
    }
    if (nameWords.length > 0 && tagHits > 0) {
      score += Math.min((tagHits / nameWords.length) * 0.10, 0.10);
    }
  }

  // ─── Signal 4: PYQ keywords appearing in concept name ──
  // Catches: concept "Article 21 Right to Life" matching PYQ keyword "article 21"
  for (const pk of pyqKeywords) {
    if (conceptName.includes(pk) && pk.length > 3) {
      score += 0.08;
      break; // One hit is enough
    }
  }

  // ─── Signal 5: Subject alignment (amplifier, not standalone) ─
  if (pyqSubject === conceptSubject && score > 0) {
    score += 0.10;
  } else if (
    (pyqSubject.includes(conceptSubject) ||
    conceptSubject.includes(pyqSubject)) && score > 0
  ) {
    score += 0.05;
  }

  // ─── Signal 6: Topic tag overlap with concept keywords ─
  for (const ck of conceptKeywords) {
    if (pyqTags.includes(ck)) score += 0.05;
  }
  // Cap tag bonus
  score = Math.min(score, 0.95);

  // ─── Signal 7: Recency boost ───────────────────────────
  if (pyq.year >= 2023) score += 0.03;
  else if (pyq.year >= 2021) score += 0.01;

  return Math.round(Math.max(0, Math.min(0.97, score)) * 100) / 100;
}

export const pyqMatchingService = {
  /**
   * Find and persist PYQ matches for a concept.
   */
  async matchConcept(params: {
    conceptId: string;
    userId: string;
    force?: boolean;
  }): Promise<{
    matches: Array<{
      pyqId: string;
      year: number;
      paper: string;
      examStage: string;
      question: string;
      subject: string;
      matchStrength: number;
      matchReason: string;
    }>;
    stats: {
      pyqsScanned: number;
      candidateMatches: number;
      persisted: number;
      skippedWeak: number;
    };
  }> {
    const stats = {
      pyqsScanned: 0,
      candidateMatches: 0,
      persisted: 0,
      skippedWeak: 0,
    };

    console.log("[PYQ-MATCH] STEP 1: Loading concept");
    const concept = await conceptRepository.findById(params.conceptId);
    if (!concept || concept.userId !== params.userId) {
      throw new Error("Concept not found or access denied");
    }

    // Idempotency check
    if (!params.force) {
      const existing = await pyqMatchRepository.findByConcept(params.conceptId);
      if (existing.length > 0) {
        console.log("[PYQ-MATCH] Returning cached matches:", existing.length);

        // Enrich with PYQ data
        const enriched = [];
        for (const match of existing) {
          const pyq = await pyqRepository.findById(match.pyqId);
          if (pyq) {
            enriched.push({
              pyqId: pyq.id,
              year: pyq.year,
              paper: pyq.paper,
              examStage: pyq.examStage,
              question: pyq.question,
              subject: pyq.subject,
              matchStrength: match.matchStrength,
              matchReason: match.matchReason,
            });
          }
        }
        return { matches: enriched, stats: { ...stats, persisted: enriched.length } };
      }
    } else {
      // Force: clear existing
      const deleted = await pyqMatchRepository.deleteByConcept(params.conceptId);
      if (deleted > 0) {
        log.info("Force mode: deleted existing PYQ matches", { conceptId: params.conceptId, deleted });
      }
    }

    // ─── Scan PYQ bank ──────────────────────────────────────
    console.log("[PYQ-MATCH] STEP 2: Scanning PYQ bank");
    const allPyqs = await pyqRepository.findAll(200);
    stats.pyqsScanned = allPyqs.length;

    console.log("[PYQ-MATCH] PYQs in bank:", allPyqs.length);

    // ─── Score each PYQ ─────────────────────────────────────
    const candidates: Array<{
      pyq: PYQ;
      score: number;
    }> = [];

    for (const pyq of allPyqs) {
      const score = calculateMatchScore(concept, pyq);

      if (score >= MIN_MATCH_STRENGTH) {
        candidates.push({ pyq, score });
        stats.candidateMatches++;
      } else {
        stats.skippedWeak++;
      }
    }

    // Sort by strength and take top 8 (allows reasonable coverage for small PYQ bank)
    candidates.sort((a, b) => b.score - a.score);
    const topMatches = candidates.slice(0, 8);

    console.log("[PYQ-MATCH] STEP 3: Candidates:", stats.candidateMatches, "| Top:", topMatches.length);

    // ─── Generate match reasons (deterministic, not AI) ──────
    const toInsert = topMatches.map((match) => {
      const reason = generateMatchReason(concept, match.pyq, match.score);
      return {
        conceptId: params.conceptId,
        pyqId: match.pyq.id,
        matchStrength: match.score,
        matchReason: reason,
        matchMetadata: {
          conceptName: concept.displayName,
          conceptSubject: concept.subject,
          pyqYear: match.pyq.year,
          pyqPaper: match.pyq.paper,
        },
      };
    });

    // ─── Persist ────────────────────────────────────────────
    console.log("[PYQ-MATCH] STEP 4: Persisting", toInsert.length, "matches");

    if (toInsert.length > 0) {
      try {
        const persisted = await pyqMatchRepository.createMany(toInsert);
        stats.persisted = persisted.length;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("PYQ match persistence failed", { error: msg });
      }
    }

    console.log("[PYQ-MATCH] STEP 5: Complete", stats);

    return {
      matches: topMatches.map((m) => ({
        pyqId: m.pyq.id,
        year: m.pyq.year,
        paper: m.pyq.paper,
        examStage: m.pyq.examStage,
        question: m.pyq.question,
        subject: m.pyq.subject,
        matchStrength: m.score,
        matchReason: generateMatchReason(concept, m.pyq, m.score),
      })),
      stats,
    };
  },

  /**
   * Get existing PYQ matches for a concept.
   */
  async getMatches(conceptId: string) {
    const matches = await pyqMatchRepository.findByConcept(conceptId);

    const enriched = [];
    for (const match of matches) {
      const pyq = await pyqRepository.findById(match.pyqId);
      if (pyq) {
        enriched.push({
          id: match.id,
          pyqId: pyq.id,
          year: pyq.year,
          paper: pyq.paper,
          examStage: pyq.examStage,
          question: pyq.question,
          subject: pyq.subject,
          matchStrength: match.matchStrength,
          matchReason: match.matchReason,
          createdAt: match.createdAt,
        });
      }
    }

    return enriched;
  },
};

/**
 * Generate a human-readable match reason (deterministic, no AI).
 * Explains WHY this PYQ is relevant to the concept.
 */
function generateMatchReason(concept: Concept, pyq: PYQ, score: number): string {
  const parts: string[] = [];

  // Subject alignment
  if (concept.subject.toLowerCase() === pyq.subject.toLowerCase()) {
    parts.push(`Direct ${concept.subject} question`);
  } else {
    parts.push(`Cross-subject link (${concept.subject} ↔ ${pyq.subject})`);
  }

  // Name in question
  if (pyq.question.toLowerCase().includes(concept.normalizedName.toLowerCase())) {
    parts.push("Concept directly referenced in question");
  }

  // Name in PYQ keywords/tags
  const pyqTags = (pyq.topicTags ?? []).map((t) => t.toLowerCase());
  const pyqKw = (pyq.keywords ?? []).map((k) => k.toLowerCase());
  if (pyqTags.includes(concept.normalizedName.toLowerCase()) || pyqKw.includes(concept.normalizedName.toLowerCase())) {
    parts.push("Concept is a tagged topic of this question");
  }

  // Keyword overlap
  const conceptKw = (concept.keywords ?? []).map((k) => k.toLowerCase());
  const overlap = conceptKw.filter((k) => pyqKw.includes(k));
  if (overlap.length > 0) {
    parts.push(`Shared keywords: ${overlap.slice(0, 3).join(", ")}`);
  }

  // Year context
  parts.push(`Asked in UPSC ${pyq.examStage.toUpperCase()} ${pyq.year} (${pyq.paper})`);

  return parts.join(". ") + ".";
}
