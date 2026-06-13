/**
 * Adaptive Intelligence Engines — Phase 4.
 *
 * ALL PURE FUNCTIONS — no side effects, no DB calls, no AI calls.
 *
 * These engines compute adaptive intelligence from existing data:
 * - Subject strength profiling
 * - Syllabus coverage analysis
 * - Concept gap detection
 * - Study pattern analysis
 * - Adaptive recommendations
 *
 * Every output is deterministic, explainable, and evidence-based.
 */

import type { Concept, ConceptMasteryRecord } from "@/types/database.types";
import type { SyllabusNode } from "@/lib/db/seeds/seeds";
import { UPSC_SUBJECTS, type UPSCSubject } from "@/lib/ai/subjects";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TYPES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface SubjectStrength {
  subject: string;
  /** Overall strength 0-1 */
  score: number;
  conceptCount: number;
  masteryDistribution: {
    mastered: number;
    reviewing: number;
    learning: number;
    unseen: number;
  };
  averageConfidence: number;
  weakConceptCount: number;
  /** Evidence trails for explainability */
  evidence: string[];
}

export interface CoverageEntry {
  paper: string;
  domain: string;
  totalSubtopics: number;
  coveredSubtopics: number;
  coveragePercent: number;
  uncoveredSubtopics: string[];
}

export interface PaperCoverage {
  paper: string;
  totalDomains: number;
  totalSubtopics: number;
  coveredSubtopics: number;
  coveragePercent: number;
  domains: CoverageEntry[];
}

export interface ConceptGap {
  type: "prerequisite" | "domain" | "cross_subject";
  description: string;
  subject: string;
  severity: "low" | "moderate" | "high";
  evidence: string;
}

export interface StudyPatterns {
  /** Subject balance: how evenly distributed is study across subjects */
  subjectBalance: number; // 0-1, 1 = perfectly balanced
  /** Most studied subject */
  dominantSubject: string | null;
  /** Least studied subject */
  neglectedSubject: string | null;
  /** Subjects with zero concepts */
  untouchedSubjects: string[];
  /** Average concepts per subject */
  averageConceptsPerSubject: number;
  /** Distribution */
  distribution: Record<string, number>;
}

export interface SubjectWeakness {
  subject: string;
  weaknessScore: number; // 0-1, higher = weaker
  signals: string[];
  weakConceptCount: number;
  totalConceptCount: number;
}

export interface AdaptiveRecommendation {
  type: "study" | "revise" | "explore" | "focus";
  target: string; // concept name, subject name, or domain
  targetType: "concept" | "subject" | "domain";
  reason: string;
  priority: number; // 0-1
  signals: string[];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENGINE 1: SUBJECT STRENGTH PROFILING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function computeSubjectStrengths(
  concepts: Concept[],
  mastery: ConceptMasteryRecord[]
): SubjectStrength[] {
  // Group concepts by subject
  const conceptsBySubject = new Map<string, Concept[]>();
  for (const c of concepts) {
    const group = conceptsBySubject.get(c.subject) ?? [];
    group.push(c);
    conceptsBySubject.set(c.subject, group);
  }

  // Build mastery lookup
  const masteryByConceptId = new Map<string, ConceptMasteryRecord>();
  for (const m of mastery) {
    masteryByConceptId.set(m.conceptId, m);
  }

  const strengths: SubjectStrength[] = [];

  for (const subject of UPSC_SUBJECTS) {
    const subjectConcepts = conceptsBySubject.get(subject) ?? [];
    const count = subjectConcepts.length;

    if (count === 0) {
      strengths.push({
        subject,
        score: 0,
        conceptCount: 0,
        masteryDistribution: { mastered: 0, reviewing: 0, learning: 0, unseen: 0 },
        averageConfidence: 0,
        weakConceptCount: 0,
        evidence: ["No concepts studied yet"],
      });
      continue;
    }

    const dist = { mastered: 0, reviewing: 0, learning: 0, unseen: 0 };
    let confidenceSum = 0;
    let weakCount = 0;
    const evidence: string[] = [];

    for (const c of subjectConcepts) {
      const m = masteryByConceptId.get(c.id);
      if (!m) {
        dist.unseen++;
        continue;
      }

      switch (m.masteryLevel) {
        case "mastered": dist.mastered++; break;
        case "reviewing": dist.reviewing++; break;
        case "learning": dist.learning++; break;
        default: dist.unseen++;
      }

      confidenceSum += Number(m.confidenceScore);
      if (m.isWeakArea) weakCount++;
    }

    // Score: weighted combination of mastery distribution
    const masteredWeight = dist.mastered * 1.0;
    const reviewingWeight = dist.reviewing * 0.6;
    const learningWeight = dist.learning * 0.3;
    const score = Math.round(
      ((masteredWeight + reviewingWeight + learningWeight) / count) * 100
    ) / 100;

    const avgConfidence = Math.round((confidenceSum / count) * 100) / 100;

    // Build evidence
    if (dist.mastered > 0) evidence.push(`${dist.mastered} concepts mastered`);
    if (dist.reviewing > 0) evidence.push(`${dist.reviewing} under active review`);
    if (weakCount > 0) evidence.push(`${weakCount} weak areas detected`);
    if (count > 0 && dist.unseen === count) evidence.push("All concepts unseen — no revision started");

    strengths.push({
      subject,
      score: Math.min(score, 1.0),
      conceptCount: count,
      masteryDistribution: dist,
      averageConfidence: avgConfidence,
      weakConceptCount: weakCount,
      evidence,
    });
  }

  // Sort by score ascending (weakest first — more useful for recommendations)
  strengths.sort((a, b) => a.score - b.score);
  return strengths;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENGINE 2: SYLLABUS COVERAGE ANALYSIS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Compute syllabus coverage by comparing studied concepts
 * against the full ontology.
 *
 * @param ontologyNodes All syllabus nodes from flattenSyllabus()
 * @param mappedSubtopics Set of subtopic strings that concepts map to
 */
export function computeSyllabusCoverage(
  ontologyNodes: SyllabusNode[],
  mappedSubtopics: Set<string>
): PaperCoverage[] {
  // Group by paper → domain
  const papers = new Map<string, Map<string, string[]>>();

  for (const node of ontologyNodes) {
    if (!papers.has(node.paper)) papers.set(node.paper, new Map());
    const domains = papers.get(node.paper)!;
    if (!domains.has(node.domain)) domains.set(node.domain, []);
    domains.get(node.domain)!.push(node.subtopic);
  }

  const result: PaperCoverage[] = [];

  for (const [paper, domains] of papers) {
    let paperTotal = 0;
    let paperCovered = 0;
    const domainEntries: CoverageEntry[] = [];

    for (const [domain, subtopics] of domains) {
      const covered = subtopics.filter((s) => mappedSubtopics.has(s.toLowerCase()));
      const uncovered = subtopics.filter((s) => !mappedSubtopics.has(s.toLowerCase()));

      paperTotal += subtopics.length;
      paperCovered += covered.length;

      domainEntries.push({
        paper,
        domain,
        totalSubtopics: subtopics.length,
        coveredSubtopics: covered.length,
        coveragePercent: subtopics.length > 0
          ? Math.round((covered.length / subtopics.length) * 100)
          : 0,
        uncoveredSubtopics: uncovered,
      });
    }

    result.push({
      paper,
      totalDomains: domains.size,
      totalSubtopics: paperTotal,
      coveredSubtopics: paperCovered,
      coveragePercent: paperTotal > 0
        ? Math.round((paperCovered / paperTotal) * 100)
        : 0,
      domains: domainEntries,
    });
  }

  return result;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENGINE 3: CONCEPT GAP DETECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Detect concept gaps using:
 * - Domain coverage (studied domain but missed subtopics)
 * - Subject imbalance (some subjects deeply studied, others neglected)
 *
 * @param coverage Computed coverage from Engine 2
 * @param strengths Computed strengths from Engine 1
 */
export function detectConceptGaps(
  coverage: PaperCoverage[],
  strengths: SubjectStrength[]
): ConceptGap[] {
  const gaps: ConceptGap[] = [];

  // Gap type 1: Domain gaps — studied some subtopics but missing others
  for (const paper of coverage) {
    for (const domain of paper.domains) {
      // Only flag domains where SOME coverage exists (partially studied)
      if (domain.coveredSubtopics > 0 && domain.uncoveredSubtopics.length > 0) {
        // Severity based on coverage ratio
        const ratio = domain.coveredSubtopics / domain.totalSubtopics;
        const severity: ConceptGap["severity"] =
          ratio < 0.3 ? "high" : ratio < 0.6 ? "moderate" : "low";

        gaps.push({
          type: "domain",
          description: `${domain.uncoveredSubtopics.length} subtopics in ${domain.domain} (${paper.paper}) remain unexplored`,
          subject: paper.paper,
          severity,
          evidence: `Covered ${domain.coveredSubtopics}/${domain.totalSubtopics} subtopics. Missing: ${domain.uncoveredSubtopics.slice(0, 3).join(", ")}${domain.uncoveredSubtopics.length > 3 ? "..." : ""}`,
        });
      }
    }
  }

  // Gap type 2: Cross-subject imbalance
  const activeSubjects = strengths.filter((s) => s.conceptCount > 0);
  const inactiveSubjects = strengths.filter((s) => s.conceptCount === 0);

  if (activeSubjects.length > 0 && inactiveSubjects.length > 0) {
    for (const inactive of inactiveSubjects) {
      gaps.push({
        type: "cross_subject",
        description: `${inactive.subject} has no concepts studied while other subjects are active`,
        subject: inactive.subject,
        severity: "moderate",
        evidence: `${activeSubjects.length} subjects have concepts; ${inactive.subject} has zero`,
      });
    }
  }

  // Sort by severity
  const severityOrder: Record<string, number> = { high: 3, moderate: 2, low: 1 };
  gaps.sort((a, b) => (severityOrder[b.severity] ?? 0) - (severityOrder[a.severity] ?? 0));

  // Cap at 15 to avoid overwhelming
  return gaps.slice(0, 15);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENGINE 4: STUDY PATTERN ANALYSIS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function analyzeStudyPatterns(concepts: Concept[]): StudyPatterns {
  // Distribution by subject
  const distribution: Record<string, number> = {};
  for (const subject of UPSC_SUBJECTS) {
    distribution[subject] = 0;
  }
  for (const c of concepts) {
    distribution[c.subject] = (distribution[c.subject] ?? 0) + 1;
  }

  const totalConcepts = concepts.length;
  if (totalConcepts === 0) {
    return {
      subjectBalance: 0,
      dominantSubject: null,
      neglectedSubject: null,
      untouchedSubjects: [...UPSC_SUBJECTS],
      averageConceptsPerSubject: 0,
      distribution,
    };
  }

  // Subject balance: use coefficient of variation (lower = more balanced)
  const values = Object.values(distribution);
  const mean = totalConcepts / UPSC_SUBJECTS.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  // Normalize: balance = 1 - (cv / threshold). CV > 1.5 = totally imbalanced
  const cv = mean > 0 ? stdDev / mean : 0;
  const balance = Math.max(0, Math.round((1 - cv / 1.5) * 100) / 100);

  // Find dominant and neglected
  let dominant: string | null = null;
  let neglected: string | null = null;
  let maxCount = 0;
  let minCount = Infinity;

  for (const [subject, count] of Object.entries(distribution)) {
    if (count > maxCount) { maxCount = count; dominant = subject; }
    if (count < minCount && count > 0) { minCount = count; neglected = subject; }
  }

  const untouched = UPSC_SUBJECTS.filter((s) => (distribution[s] ?? 0) === 0);

  // If there are untouched subjects, they're more neglected than any studied subject
  if (untouched.length > 0) {
    neglected = untouched[0];
  }

  return {
    subjectBalance: balance,
    dominantSubject: dominant,
    neglectedSubject: neglected,
    untouchedSubjects: untouched,
    averageConceptsPerSubject: Math.round((totalConcepts / UPSC_SUBJECTS.length) * 10) / 10,
    distribution,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENGINE 5: SUBJECT WEAKNESS DETECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function computeSubjectWeaknesses(
  strengths: SubjectStrength[],
  mastery: ConceptMasteryRecord[]
): SubjectWeakness[] {
  // Group mastery by subject (need concept → subject mapping via strengths)
  const weaknesses: SubjectWeakness[] = [];

  for (const strength of strengths) {
    if (strength.conceptCount === 0) continue;

    const signals: string[] = [];
    let weaknessScore = 0;

    // Signal 1: High proportion of weak concepts
    if (strength.weakConceptCount > 0) {
      const weakRatio = strength.weakConceptCount / strength.conceptCount;
      if (weakRatio >= 0.5) {
        signals.push(`${Math.round(weakRatio * 100)}% of concepts are weak areas`);
        weaknessScore += 0.35;
      } else if (weakRatio >= 0.25) {
        signals.push(`${Math.round(weakRatio * 100)}% of concepts are weak areas`);
        weaknessScore += 0.20;
      }
    }

    // Signal 2: Low overall strength
    if (strength.score < 0.3) {
      signals.push(`Overall strength is low (${strength.score})`);
      weaknessScore += 0.25;
    }

    // Signal 3: Low average confidence
    if (strength.averageConfidence < 0.4 && strength.conceptCount >= 2) {
      signals.push(`Low average confidence (${strength.averageConfidence})`);
      weaknessScore += 0.20;
    }

    // Signal 4: High unseen ratio
    const unseenRatio = strength.masteryDistribution.unseen / strength.conceptCount;
    if (unseenRatio >= 0.7 && strength.conceptCount >= 3) {
      signals.push(`${Math.round(unseenRatio * 100)}% of concepts have no revision`);
      weaknessScore += 0.20;
    }

    if (signals.length > 0) {
      weaknesses.push({
        subject: strength.subject,
        weaknessScore: Math.round(Math.min(weaknessScore, 1.0) * 100) / 100,
        signals,
        weakConceptCount: strength.weakConceptCount,
        totalConceptCount: strength.conceptCount,
      });
    }
  }

  weaknesses.sort((a, b) => b.weaknessScore - a.weaknessScore);
  return weaknesses;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENGINE 6: ADAPTIVE RECOMMENDATION GENERATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Maximum recommendations to generate. Keeps output sparse. */
const MAX_RECOMMENDATIONS = 8;

export function generateRecommendations(params: {
  strengths: SubjectStrength[];
  weaknesses: SubjectWeakness[];
  gaps: ConceptGap[];
  patterns: StudyPatterns;
  coverage: PaperCoverage[];
}): AdaptiveRecommendation[] {
  const recs: AdaptiveRecommendation[] = [];

  // Rec type 1: Focus on weak subjects
  for (const weakness of params.weaknesses.slice(0, 2)) {
    recs.push({
      type: "focus",
      target: weakness.subject,
      targetType: "subject",
      reason: `${weakness.subject} shows weakness: ${weakness.signals[0]}`,
      priority: 0.3 + weakness.weaknessScore * 0.5,
      signals: weakness.signals,
    });
  }

  // Rec type 2: Explore untouched subjects
  for (const subject of params.patterns.untouchedSubjects.slice(0, 2)) {
    recs.push({
      type: "explore",
      target: subject,
      targetType: "subject",
      reason: `${subject} has no concepts studied yet — consider starting`,
      priority: 0.4,
      signals: ["zero_concepts"],
    });
  }

  // Rec type 3: Fill domain gaps (high severity only)
  for (const gap of params.gaps.filter((g) => g.severity === "high").slice(0, 2)) {
    recs.push({
      type: "study",
      target: gap.description,
      targetType: "domain",
      reason: gap.evidence,
      priority: 0.5,
      signals: [gap.type, gap.severity],
    });
  }

  // Rec type 4: Balance study if imbalanced
  if (params.patterns.subjectBalance < 0.4 && params.patterns.neglectedSubject) {
    recs.push({
      type: "explore",
      target: params.patterns.neglectedSubject,
      targetType: "subject",
      reason: `Study balance is low (${params.patterns.subjectBalance}). ${params.patterns.neglectedSubject} is least covered.`,
      priority: 0.35,
      signals: ["imbalanced_study"],
    });
  }

  // Rec type 5: Low coverage papers
  for (const paper of params.coverage) {
    if (paper.coveragePercent < 20 && paper.coveredSubtopics > 0) {
      recs.push({
        type: "explore",
        target: paper.paper,
        targetType: "domain",
        reason: `${paper.paper} coverage is only ${paper.coveragePercent}% — ${paper.coveredSubtopics}/${paper.totalSubtopics} subtopics`,
        priority: 0.3,
        signals: ["low_coverage"],
      });
    }
  }

  // Sort by priority, cap
  recs.sort((a, b) => b.priority - a.priority);
  return recs.slice(0, MAX_RECOMMENDATIONS);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ADAPTIVE DIFFICULTY CALCULATOR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Compute recommended question difficulty based on mastery state.
 * Deterministic, explainable.
 */
export function computeAdaptiveDifficulty(
  masteryLevel: string,
  confidenceScore: number,
  correctCount: number,
  incorrectCount: number
): {
  recommended: "easy" | "moderate" | "hard";
  reason: string;
} {
  const total = correctCount + incorrectCount;
  const accuracy = total > 0 ? correctCount / total : 0;

  // Mastered + high accuracy → hard
  if (masteryLevel === "mastered" && accuracy >= 0.8) {
    return { recommended: "hard", reason: "Mastered with high accuracy — challenge with harder questions" };
  }

  // Reviewing + decent accuracy → moderate
  if (masteryLevel === "reviewing" && accuracy >= 0.6) {
    return { recommended: "moderate", reason: "Under review with decent accuracy — moderate challenge" };
  }

  // Learning or low accuracy → easy
  if (masteryLevel === "learning" || accuracy < 0.5) {
    return { recommended: "easy", reason: "Still learning or low accuracy — build confidence with easier questions" };
  }

  // Default
  return { recommended: "moderate", reason: "Standard difficulty" };
}
