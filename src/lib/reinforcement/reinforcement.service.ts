/**
 * Reinforcement Service — retrieval only.
 *
 * Given a concept, the student's failureReason and the repair outcome, pull
 * the EXISTING Knowledge that is most useful right now:
 *   - the concept's latest note (core idea, hooks, triggers, static↔current)
 *   - matched PYQs
 *   - "dominoes": the strongest related concepts, each with its note's core
 *     idea and one question from its existing inventory
 *   - one transfer MCQ on the same concept the student has not attempted
 *
 * Zero LLM calls. Zero new tables. Nothing is duplicated — every field comes
 * from a row that already exists. SM-2 and mastery are never touched.
 */

import { conceptRepository } from "@/lib/repositories/concept.repository";
import { noteRepository } from "@/lib/repositories/note.repository";
import { conceptQuestionsRepository } from "@/lib/repositories/concept-questions.repository";
import { relationshipRepository } from "@/lib/repositories/relationship.repository";
import { revisionRepository } from "@/lib/repositories/revision.repository";
import { pyqMatchingService } from "@/lib/ai/services/pyq-matching.service";
import type { FailureReason } from "@/lib/evidence/evidence.types";
import {
  summarizeHistory,
  pickTransferMcq,
  orderSections,
  type ReinforcementMcq,
  type ReinforcementOutcome,
  type ReinforcementSection,
} from "./reinforcement.engine";

// ─── Response contract ──────────────────────────────────────

export interface ReinforcementNote {
  coreIdea: string;
  memoryHooks: string[];
  examTriggers: string[];
  staticCurrentLink: string[];
  answerWritingAngles: string[];
}

export interface ReinforcementPyq {
  year: number;
  paper: string;
  examStage: string;
  question: string;
  matchReason: string;
}

export interface ReinforcementDomino {
  conceptId: string;
  conceptName: string;
  subject: string;
  relationshipType: string;
  reason: string;
  coreIdea: string | null;
  mcq: ReinforcementMcq | null;
}

export interface ReinforcementSession {
  concept: { id: string; displayName: string; subject: string };
  failureReason: FailureReason | null;
  outcome: ReinforcementOutcome;
  /** Which sections to render, in order. Only sections with content. */
  order: ReinforcementSection[];
  note: ReinforcementNote | null;
  transferMcq: ReinforcementMcq | null;
  pyqs: ReinforcementPyq[];
  dominoes: ReinforcementDomino[];
  mainsAngle: string | null;
  history: {
    mcqAttempts: number;
    mcqCorrect: number;
    repairCount: number;
    lastVerificationCorrect: boolean | null;
    lastUnderstanding: string | null;
  };
}

const MAX_PYQS = 3;
const MAX_DOMINOES = 2;

// ─── Service ────────────────────────────────────────────────

export const reinforcementService = {
  async build(params: {
    userId: string;
    conceptId: string;
    failureReason: FailureReason | null;
    outcome: ReinforcementOutcome;
    excludeQuestionId?: string | null;
    excludeQuestionIndex?: number | null;
    excludeQuestionIds?: readonly string[] | null;
    excludeQuestionIndexes?: readonly number[] | null;
  }): Promise<ReinforcementSession | null> {
    const { userId, conceptId, failureReason, outcome } = params;

    const concept = await conceptRepository.findById(conceptId);
    if (!concept || concept.userId !== userId) return null;

    // Everything below is independent — fetch in parallel.
    const [events, noteRow, questionsRow, pyqMatches, relationships] = await Promise.all([
      revisionRepository.getConceptHistory(userId, conceptId, 200),
      noteRepository.findLatestByConceptId(conceptId),
      conceptQuestionsRepository.findByConcept(conceptId),
      pyqMatchingService.getMatches(conceptId).catch(() => []),
      relationshipRepository.findByConcept(conceptId).catch(() => []),
    ]);

    const history = summarizeHistory(events);

    const note: ReinforcementNote | null = noteRow
      ? {
          coreIdea: noteRow.coreIdea ?? "",
          memoryHooks: noteRow.memoryHooks ?? [],
          examTriggers: noteRow.examTriggers ?? [],
          staticCurrentLink: noteRow.staticCurrentLink ?? [],
          answerWritingAngles: noteRow.answerWritingAngles ?? [],
        }
      : null;

    const rawMcqs = Array.isArray(questionsRow?.prelimsMcqs)
      ? (questionsRow!.prelimsMcqs as unknown[])
      : [];
    const transferMcq = pickTransferMcq(rawMcqs, history, {
      questionId: params.excludeQuestionId ?? null,
      questionIndex: params.excludeQuestionIndex ?? null,
      questionIds: params.excludeQuestionIds ?? null,
      questionIndexes: params.excludeQuestionIndexes ?? null,
    });

    const pyqs: ReinforcementPyq[] = [...pyqMatches]
      .sort((a, b) => Number(b.matchStrength) - Number(a.matchStrength))
      .slice(0, MAX_PYQS)
      .map((m) => ({
        year: m.year,
        paper: m.paper,
        examStage: m.examStage,
        question: m.question,
        matchReason: m.matchReason,
      }));

    const dominoes = await this.buildDominoes(userId, conceptId, relationships);

    const mainsAngle = note?.answerWritingAngles[0] ?? null;

    // Order by reason + outcome + history, then drop sections with no content.
    const order = orderSections({ failureReason, outcome, history }).filter((s) => {
      switch (s) {
        case "coreIdea": return !!note?.coreIdea;
        case "hooks": return (note?.memoryHooks.length ?? 0) > 0;
        case "triggers": return (note?.examTriggers.length ?? 0) > 0;
        case "staticCurrent": return (note?.staticCurrentLink.length ?? 0) > 0;
        case "transferMcq": return transferMcq !== null;
        case "pyqs": return pyqs.length > 0;
        case "dominoes": return dominoes.length > 0;
        case "mainsAngle": return mainsAngle !== null;
      }
    });

    return {
      concept: { id: concept.id, displayName: concept.displayName, subject: concept.subject },
      failureReason,
      outcome,
      order,
      note,
      transferMcq,
      pyqs,
      dominoes,
      mainsAngle,
      history: {
        mcqAttempts: history.mcqAttempts,
        mcqCorrect: history.mcqCorrect,
        repairCount: history.repairCount,
        lastVerificationCorrect: history.lastVerificationCorrect,
        lastUnderstanding: history.lastUnderstanding,
      },
    };
  },

  /**
   * Strongest related concepts, with their existing note's core idea and one
   * unseen question each. These are the "dominoes" — grounded in the stored
   * concept_relationships, never invented.
   */
  async buildDominoes(
    userId: string,
    conceptId: string,
    relationships: Array<{
      sourceConceptId: string;
      targetConceptId: string;
      relationshipType: string;
      relationshipReason: string;
      relationshipStrength: number;
    }>,
  ): Promise<ReinforcementDomino[]> {
    const ranked = [...relationships]
      .sort((a, b) => b.relationshipStrength - a.relationshipStrength)
      .map((r) => ({
        otherId: r.sourceConceptId === conceptId ? r.targetConceptId : r.sourceConceptId,
        relationshipType: r.relationshipType,
        reason: r.relationshipReason,
      }))
      .filter((r) => r.otherId !== conceptId);

    const picked: typeof ranked = [];
    const seen = new Set<string>();
    for (const r of ranked) {
      if (seen.has(r.otherId)) continue;
      seen.add(r.otherId);
      picked.push(r);
      if (picked.length >= MAX_DOMINOES) break;
    }
    if (picked.length === 0) return [];

    const ids = picked.map((p) => p.otherId);
    // Four batch queries for all dominoes — never one per domino.
    const [concepts, notes, questionRows, eventRows] = await Promise.all([
      conceptRepository.findByIds(ids),
      noteRepository.findLatestForConcepts(ids),
      conceptQuestionsRepository.findByConcepts(ids),
      revisionRepository.getEventsForConcepts(userId, ids),
    ]);
    // Only this user's concepts can be dominoes.
    const conceptMap = new Map(concepts.filter((c) => c.userId === userId).map((c) => [c.id, c]));
    const questionsByConcept = new Map(questionRows.map((q) => [q.conceptId, q]));
    const eventsByConcept = new Map<string, typeof eventRows>();
    for (const e of eventRows) {
      const list = eventsByConcept.get(e.conceptId) ?? [];
      list.push(e);
      eventsByConcept.set(e.conceptId, list);
    }

    const dominoes: ReinforcementDomino[] = [];
    for (const p of picked) {
      const c = conceptMap.get(p.otherId);
      if (!c) continue;

      const questionsRow = questionsByConcept.get(c.id);
      const events = eventsByConcept.get(c.id) ?? [];
      const rawMcqs = Array.isArray(questionsRow?.prelimsMcqs)
        ? (questionsRow!.prelimsMcqs as unknown[])
        : [];

      dominoes.push({
        conceptId: c.id,
        conceptName: c.displayName,
        subject: c.subject,
        relationshipType: p.relationshipType,
        reason: p.reason,
        coreIdea: notes.get(c.id)?.coreIdea || null,
        mcq: pickTransferMcq(rawMcqs, summarizeHistory(events)),
      });
    }

    return dominoes;
  },
};
