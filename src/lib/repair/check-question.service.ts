/**
 * Check-question service — gathers candidates for a repair's check question.
 *
 * Reads only: the concept's own audited question bank, audited banks of
 * related concepts (concept graph + terms the repair discussed), the
 * student's attempt history, and matched real PYQs. Writes nothing.
 */

import { conceptRepository } from "@/lib/repositories/concept.repository";
import { conceptQuestionsRepository } from "@/lib/repositories/concept-questions.repository";
import { relationshipRepository } from "@/lib/repositories/relationship.repository";
import { revisionRepository } from "@/lib/repositories/revision.repository";
import { pyqMatchingService } from "@/lib/ai/services/pyq-matching.service";
import { normalizeMcq } from "@/lib/reinforcement/reinforcement.engine";
import { rankByTermOverlap, type CheckCandidate } from "./check-question";

const MAX_GRAPH_NEIGHBOURS = 4;
const MAX_TERM_NEIGHBOURS = 3;

export interface RepairContextData {
  /** Names of graph-linked concepts — handed to the executor as adjacent topics. */
  adjacentTopics: string[];
  /** Real UPSC PYQ texts matched to this concept. */
  examinedPyqs: string[];
  graphNeighbourIds: string[];
}

export const checkQuestionService = {
  /** Context needed BEFORE the executor runs (adjacent topics, PYQs). */
  async preExecutionContext(conceptId: string, userId: string): Promise<RepairContextData> {
    const [rels, pyqs] = await Promise.all([
      relationshipRepository.findByConcept(conceptId).catch(() => []),
      pyqMatchingService.getMatches(conceptId).catch(() => []),
    ]);
    const neighbourIds = [...new Set(
      [...rels]
        .sort((a, b) => b.relationshipStrength - a.relationshipStrength)
        .map((r) => (r.sourceConceptId === conceptId ? r.targetConceptId : r.sourceConceptId))
        .filter((id) => id !== conceptId),
    )].slice(0, MAX_GRAPH_NEIGHBOURS);
    const neighbours = neighbourIds.length ? await conceptRepository.findByIds(neighbourIds) : [];
    return {
      adjacentTopics: neighbours.filter((c) => c.userId === userId).map((c) => c.displayName),
      examinedPyqs: pyqs.map((p) => `${p.year} ${p.paper}: ${p.question}`),
      graphNeighbourIds: neighbours.filter((c) => c.userId === userId).map((c) => c.id),
    };
  },

  /**
   * Bank candidates for the check question: the concept's own audited MCQs,
   * then audited MCQs of graph neighbours and of concepts whose terms the
   * repair discussed. Unaudited inventories are never used.
   */
  async candidates(params: {
    userId: string;
    conceptId: string;
    shownText: string;
    graphNeighbourIds: string[];
  }): Promise<CheckCandidate[]> {
    const { userId, conceptId, shownText } = params;

    const userConcepts = await conceptRepository.findByUser(userId, 500).catch(() => []);
    const termNeighbours = rankByTermOverlap(
      shownText,
      userConcepts.map((c) => ({ id: c.id, displayName: c.displayName, keywords: c.keywords ?? [] })),
      conceptId,
      MAX_TERM_NEIGHBOURS,
    ).map((c) => c.id);

    const relatedIds = [...new Set([...params.graphNeighbourIds, ...termNeighbours])].filter((id) => id !== conceptId);
    const allIds = [conceptId, ...relatedIds];
    const nameById = new Map(userConcepts.map((c) => [c.id, c.displayName]));

    const [rows, events] = await Promise.all([
      conceptQuestionsRepository.findByConcepts(allIds).catch(() => []),
      revisionRepository.getEventsForConcepts(userId, allIds).catch(() => []),
    ]);

    const seenIds = new Set<string>();
    for (const e of events) {
      const qid = (e.eventMetadata as Record<string, unknown> | null)?.questionId;
      if (typeof qid === "string") seenIds.add(qid);
    }

    const out: CheckCandidate[] = [];
    for (const row of rows) {
      const meta = (row.generationMetadata ?? {}) as Record<string, unknown>;
      if (meta.audited !== true) continue; // only audited answer keys
      const own = row.conceptId === conceptId;
      const raw = Array.isArray(row.prelimsMcqs) ? (row.prelimsMcqs as unknown[]) : [];
      raw.forEach((r, i) => {
        const m = normalizeMcq(r, i);
        if (!m) return;
        out.push({
          mcq: { questionId: m.questionId, question: m.question, options: m.options, correctAnswer: m.correctAnswer, explanation: m.explanation },
          source: own ? { kind: "bank" } : { kind: "related", conceptName: nameById.get(row.conceptId) },
          seen: m.questionId ? seenIds.has(m.questionId) : false,
        });
      });
    }
    return out;
  },
};
