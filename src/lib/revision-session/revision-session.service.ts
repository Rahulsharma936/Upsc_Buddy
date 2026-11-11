/**
 * Revision Session Service.
 *
 * Assembles today's question-based revision session from things that already
 * exist: the revision engine's due-and-prioritized recommendations, each
 * concept's existing question inventory, its latest note (for the recall
 * fallback), and its event history (for unseen-first selection and for
 * resuming a session already partly done today).
 *
 * Zero LLM calls. Zero writes. SM-2 untouched — answers go through the
 * existing POST /api/revision actions from the client.
 */

import { revisionIntelligenceService } from "@/lib/ai/services/revision-intelligence.service";
import { noteRepository } from "@/lib/repositories/note.repository";
import { conceptQuestionsRepository } from "@/lib/repositories/concept-questions.repository";
import { revisionRepository } from "@/lib/repositories/revision.repository";
import type { ReinforcementMcq } from "@/lib/reinforcement/reinforcement.engine";
import type { ContentScope } from "@/lib/content-scope";
import { isCompletedSince, selectSessionQuestion, pickMains, COMPLETING_EVENT_TYPES, type RevisionSessionMains } from "./revision-session.engine";

export interface RevisionSessionNote {
  coreIdea: string;
  examTriggers: string[];
  memoryHooks: string[];
}

export type { RevisionSessionMains };

export interface RevisionSessionItem {
  conceptId: string;
  conceptName: string;
  subject: string;
  masteryLevel: string;
  daysOverdue: number;
  isWeakArea: boolean;
  forgettingProbability: number;
  /** The question to ask, or null → written answer instead. */
  mcq: ReinforcementMcq | null;
  /** When there is no MCQ: a Mains question from the inventory to answer in writing. */
  mains: RevisionSessionMains | null;
  /** The note used for the recall cue / reveal, or null if none generated yet. */
  note: RevisionSessionNote | null;
  /**
   * True when the concept has no question inventory yet. The session then
   * generates UPSC-standard questions for it on the spot (POST /api/ai/questions)
   * instead of falling back to a weaker check.
   */
  needsQuestions: boolean;
  /** Already answered / assessed / skipped since `since` — resume skips it. */
  completedToday: boolean;
}

export interface RevisionSessionPayload {
  items: RevisionSessionItem[];
  totalDue: number;
  remaining: number;
  /**
   * Distinct concepts the student answered, self-assessed or skipped since
   * `since` — across ALL concepts, not just the ones still due. Answered
   * concepts are rescheduled by SM-2 and leave the due set, so this is the
   * only honest "done today" number.
   */
  doneToday: number;
  since: string;
  generatedAt: string;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

export const revisionSessionService = {
  async build(params: {
    userId: string;
    limit?: number;
    since: Date;
    /** Only static-syllabus or only current-affairs concepts (default: all). */
    scope?: ContentScope;
  }): Promise<RevisionSessionPayload> {
    const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    const [recommendations, doneToday] = await Promise.all([
      revisionIntelligenceService
        .getRecommendations({ userId: params.userId, limit, scope: params.scope ?? "all" })
        .catch(() => []),
      revisionRepository
        .countConceptsHandledSince(params.userId, params.since, [...COMPLETING_EVENT_TYPES], params.scope ?? "all")
        .catch(() => 0),
    ]);

    if (recommendations.length === 0) {
      return {
        items: [],
        totalDue: 0,
        remaining: 0,
        doneToday,
        since: params.since.toISOString(),
        generatedAt: new Date().toISOString(),
      };
    }

    const ids = recommendations.map((r) => r.conceptId);

    // Three batch queries for the whole session — never one per concept.
    const [notes, questionRows, eventRows] = await Promise.all([
      noteRepository.findLatestForConcepts(ids).catch(() => new Map()),
      conceptQuestionsRepository.findByConcepts(ids).catch(() => []),
      revisionRepository.getEventsForConcepts(params.userId, ids).catch(() => []),
    ]);
    const questionsByConcept = new Map(questionRows.map((q) => [q.conceptId, q]));
    const eventsByConcept = new Map<string, typeof eventRows>();
    for (const e of eventRows) {
      const list = eventsByConcept.get(e.conceptId) ?? [];
      list.push(e);
      eventsByConcept.set(e.conceptId, list);
    }

    const items = recommendations.map((rec): RevisionSessionItem => {
        const questionsRow = questionsByConcept.get(rec.conceptId);
        const history = eventsByConcept.get(rec.conceptId) ?? [];

        const rawMcqs = Array.isArray(questionsRow?.prelimsMcqs)
          ? (questionsRow!.prelimsMcqs as unknown[])
          : [];

        const noteRow = notes.get(rec.conceptId);
        const mcq = selectSessionQuestion(rawMcqs, history);

        return {
          conceptId: rec.conceptId,
          conceptName: rec.conceptName,
          subject: rec.subject,
          masteryLevel: rec.masteryLevel,
          daysOverdue: rec.daysOverdue,
          isWeakArea: rec.isWeakArea,
          forgettingProbability: rec.forgettingProbability,
          mcq,
          mains: mcq ? null : pickMains(questionsRow?.mainsQuestions),
          note: noteRow
            ? {
                coreIdea: noteRow.coreIdea ?? "",
                examTriggers: noteRow.examTriggers ?? [],
                memoryHooks: noteRow.memoryHooks ?? [],
              }
            : null,
          needsQuestions: rawMcqs.length === 0,
          completedToday: isCompletedSince(history, params.since),
        };
      });

    return {
      items,
      totalDue: items.length,
      remaining: items.filter((i) => !i.completedToday).length,
      doneToday,
      since: params.since.toISOString(),
      generatedAt: new Date().toISOString(),
    };
  },
};
