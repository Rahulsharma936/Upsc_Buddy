/**
 * Deterministic confidence scoring for extracted concepts.
 * 
 * Confidence is computed from 5 signals, each contributing a weighted score:
 * 1. Keyword richness    (0.20) — more keywords = higher confidence
 * 2. Extraction complete (0.20) — all fields populated
 * 3. Subject certainty   (0.25) — resolved to a canonical subject
 * 4. Concept specificity (0.20) — specific names score higher than vague ones
 * 5. Parsing reliability (0.15) — clean parse scores higher than repaired
 */

import type { UPSCSubject } from "../subjects";

interface ConceptForScoring {
  name: string;
  subject: string;
  keywords: string[];
  difficulty: string;
  /** The raw confidence the AI model itself reported (0-1). */
  aiReportedConfidence: number;
}

interface ConfidenceBreakdown {
  /** Final confidence score (0.0 – 1.0). */
  score: number;
  signals: {
    keywordRichness: number;
    extractionCompleteness: number;
    subjectCertainty: number;
    conceptSpecificity: number;
    parsingReliability: number;
  };
}

const WEIGHTS = {
  keywordRichness: 0.20,
  extractionCompleteness: 0.20,
  subjectCertainty: 0.25,
  conceptSpecificity: 0.20,
  parsingReliability: 0.15,
} as const;

/**
 * Compute a deterministic confidence score for an extracted concept.
 */
export function computeConfidence(
  concept: ConceptForScoring,
  resolvedSubject: UPSCSubject | null,
  jsonRepairApplied: boolean
): ConfidenceBreakdown {
  const signals = {
    keywordRichness: scoreKeywordRichness(concept.keywords),
    extractionCompleteness: scoreCompleteness(concept),
    subjectCertainty: scoreSubjectCertainty(concept.subject, resolvedSubject),
    conceptSpecificity: scoreSpecificity(concept.name),
    parsingReliability: scoreParsingReliability(jsonRepairApplied, concept.aiReportedConfidence),
  };

  const score =
    signals.keywordRichness * WEIGHTS.keywordRichness +
    signals.extractionCompleteness * WEIGHTS.extractionCompleteness +
    signals.subjectCertainty * WEIGHTS.subjectCertainty +
    signals.conceptSpecificity * WEIGHTS.conceptSpecificity +
    signals.parsingReliability * WEIGHTS.parsingReliability;

  return {
    score: Math.round(score * 100) / 100, // 2 decimal places
    signals,
  };
}

// ─── Signal Functions ───────────────────────────────────────

/** More keywords = richer extraction. Caps at 5 keywords. */
function scoreKeywordRichness(keywords: string[]): number {
  if (keywords.length === 0) return 0.1;
  if (keywords.length === 1) return 0.4;
  if (keywords.length === 2) return 0.6;
  if (keywords.length >= 3 && keywords.length <= 5) return 0.9;
  return 1.0; // 5+
}

/** All fields present and non-empty = complete. */
function scoreCompleteness(concept: ConceptForScoring): number {
  let filled = 0;
  const total = 4;

  if (concept.name.trim().length > 0) filled++;
  if (concept.subject.trim().length > 0) filled++;
  if (concept.keywords.length > 0) filled++;
  if (concept.difficulty.trim().length > 0) filled++;

  return filled / total;
}

/** Resolved to canonical subject = high certainty. Alias = medium. Null = low. */
function scoreSubjectCertainty(
  rawSubject: string,
  resolvedSubject: UPSCSubject | null
): number {
  if (!resolvedSubject) return 0.1; // unresolvable
  if (rawSubject === resolvedSubject) return 1.0; // exact match
  return 0.7; // alias match
}

/**
 * Specific concepts score higher than vague ones.
 * "Fundamental Rights under Article 19" > "Fiscal Deficit" > "Law"
 *
 * NOTE: Single-word concepts like "Geomorphology" or "Climatology"
 * are valid UPSC study entities — don't over-penalize them.
 * The BAD list (Polity, Economy, Geography) is handled by the prompt,
 * not by this scorer.
 */
function scoreSpecificity(name: string): number {
  const wordCount = name.trim().split(/\s+/).length;

  if (wordCount <= 1) return 0.6; // Valid: "Geomorphology", "Climatology"
  if (wordCount === 2) return 0.75; // Good: "Fundamental Rights", "Fiscal Deficit"
  if (wordCount >= 3 && wordCount <= 6) return 0.9; // Best: "Directive Principles of State Policy"
  return 0.7; // Very long names may be sentences, not concepts
}

/** Clean JSON parse = reliable. Repaired JSON = less reliable. */
function scoreParsingReliability(
  jsonRepairApplied: boolean,
  aiReportedConfidence: number
): number {
  const parseScore = jsonRepairApplied ? 0.5 : 1.0;
  // Blend parse reliability with AI's own confidence
  return parseScore * 0.6 + Math.min(aiReportedConfidence, 1.0) * 0.4;
}
