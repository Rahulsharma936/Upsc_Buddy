/**
 * Page chat service — answers one question about a newspaper page, grounded in
 * the page, the student's notes, the syllabus and the verified PYQ bank.
 * Read-only: nothing is stored.
 */

import { conceptRepository } from "@/lib/repositories/concept.repository";
import { noteRepository } from "@/lib/repositories/note.repository";
import { syllabusRepository } from "@/lib/repositories/syllabus.repository";
import { pyqRepository } from "@/lib/repositories/pyq.repository";
import { validateAIResponse } from "@/lib/ai/utils/response-validator";
import { groqChat } from "@/lib/ai/groq-direct";
import { needsOcr } from "./newspaper";
import { newspaperService, NewspaperError } from "./newspaper.service";
import {
  CHAT_SYSTEM_PROMPT,
  buildChatPrompt,
  chatModelSchema,
  rankByTerms,
  retrievalQuery,
  selectPassages,
  splitPassages,
  tidyBullets,
  trimHistory,
  unverifiedPyqYears,
  validIndices,
  type ChatPastQuestion,
  type ChatRequest,
  type ChatSyllabusTopic,
} from "./page-chat";

const CHAT_MAX_TOKENS = 1_600;
const REFERENCE_TTL_MS = 10 * 60_000;

export interface ChatReply {
  answer: string;
  beyond: string;
  outOfScope: boolean;
  notes: Array<{ id: string; name: string }>;
  syllabus: ChatSyllabusTopic[];
  pastQuestions: ChatPastQuestion[];
  /** Past-paper years the answer mentions that the app could not verify. */
  unverifiedYears: number[];
  /** True when only part of the page fitted in the context. */
  partialPage: boolean;
  /** Returned once when the page had to be read from its image, so the browser can reuse it. */
  pageText?: string;
  model: string;
}

// Syllabus and the PYQ bank are shared, static reference data: cache them briefly.
interface PyqEntry {
  q: ChatPastQuestion;
  /** Question text plus its keywords and topic tags, used only for matching. */
  match: string;
}
let reference: { at: number; syllabus: ChatSyllabusTopic[]; pyqs: PyqEntry[] } | null = null;

async function loadReference() {
  if (reference && Date.now() - reference.at < REFERENCE_TTL_MS) return reference;
  const [papers, domains, subtopics, pyqs] = await Promise.all([
    syllabusRepository.getAllPapers(),
    syllabusRepository.getAllDomains(),
    syllabusRepository.getAllSubtopics(),
    pyqRepository.findAll(500),
  ]);
  const paperById = new Map(papers.map((p) => [p.id, p.code]));
  const domainById = new Map(domains.map((d) => [d.id, d]));
  const syllabus = subtopics.flatMap((s) => {
    const d = domainById.get(s.domainId);
    return d ? [{ paper: paperById.get(d.paperId) ?? "", domain: d.name, topic: s.name }] : [];
  });
  reference = {
    at: Date.now(),
    syllabus,
    pyqs: pyqs.map((q) => ({
      q: { year: q.year, stage: q.examStage, paper: q.paper, question: q.question },
      match: [q.question, ...(q.keywords ?? []), ...(q.topicTags ?? [])].join(" "),
    })),
  };
  return reference;
}

export const pageChatService = {
  async ask(userId: string, req: ChatRequest): Promise<ChatReply> {
    let pageText = req.text;
    let ocrText: string | undefined;
    if (needsOcr(pageText)) {
      if (!req.image) throw new NewspaperError("This page has no readable text. Its image is needed to read it.");
      pageText = await newspaperService.pageTextFromImage(req.image);
      if (needsOcr(pageText)) throw new NewspaperError("Could not read text on this page.", 422);
      ocrText = pageText;
    }

    const history = trimHistory(req.history);
    const query = retrievalQuery(req.question, history);
    const { passages, partial } = selectPassages(splitPassages(pageText), query);
    const contextText = `${query}\n${passages.map((p) => p.text).join("\n")}`;

    const [concepts, ref] = await Promise.all([conceptRepository.findByUser(userId, 500).catch(() => []), loadReference()]);

    const relatedConcepts = rankByTerms(concepts, contextText, (c) => [c.displayName, ...(c.keywords ?? [])].join(" "), 4, 2);
    const notesMap = await noteRepository.findLatestForConcepts(relatedConcepts.map((c) => c.id)).catch(() => new Map());
    const noteConcepts = relatedConcepts.filter((c) => notesMap.has(c.id));
    const notes = noteConcepts.map((c) => {
      const n = notesMap.get(c.id)!;
      return { name: c.displayName, coreIdea: String(n.coreIdea ?? "").slice(0, 400), facts: (n.examTriggers ?? []).slice(0, 3).map((f: string) => f.slice(0, 160)) };
    });
    const syllabus = rankByTerms(ref.syllabus, contextText, (s) => `${s.domain} ${s.topic}`, 3, 2);
    const pastQuestions = rankByTerms(ref.pyqs, contextText, (e) => e.match, 3, 2).map((e) => e.q);

    const { content, model } = await groqChat({
      models: [process.env.NEWSPAPER_MODEL || "openai/gpt-oss-120b", process.env.NEWSPAPER_FALLBACK_MODEL || "openai/gpt-oss-20b"],
      system: CHAT_SYSTEM_PROMPT,
      user: buildChatPrompt({
        newspaper: req.newspaper,
        editionDate: req.editionDate,
        pageNumber: req.pageNumber,
        passages,
        partial,
        notes,
        syllabus,
        pastQuestions,
        history,
        question: req.question,
      }),
      maxTokens: CHAT_MAX_TOKENS,
      json: true,
    });

    const parsed = validateAIResponse(content, chatModelSchema);
    if (!parsed.success || !parsed.data) throw new NewspaperError("Could not answer that. Please ask again.", 502);
    const out = parsed.data;

    const usedPyqs = validIndices(out.pastQuestionsUsed, pastQuestions.length).map((i) => pastQuestions[i]);
    return {
      answer: tidyBullets(out.answer),
      beyond: out.outOfScope ? "" : tidyBullets(out.beyond),
      outOfScope: out.outOfScope,
      notes: out.outOfScope ? [] : validIndices(out.notesUsed, noteConcepts.length).map((i) => ({ id: noteConcepts[i].id, name: noteConcepts[i].displayName })),
      syllabus: out.outOfScope ? [] : validIndices(out.syllabusUsed, syllabus.length).map((i) => syllabus[i]),
      pastQuestions: out.outOfScope ? [] : usedPyqs,
      unverifiedYears: unverifiedPyqYears(`${out.answer}\n${out.beyond}`, usedPyqs.map((q) => q.year)),
      partialPage: partial,
      ...(ocrText ? { pageText: ocrText } : {}),
      model,
    };
  },
};
