/**
 * Answer evidence — what the student has actually shown, per subject and per
 * concept, computed from recorded answers only (pure, browser-safe).
 *
 * Counted as answers (each scored 0..1):
 *   mcq_attempt           right = 1, wrong = 0
 *   repair_verification   the repair's check question: right = 1, wrong = 0
 *   review                written / spoken answer: mark ÷ maximum (default 10);
 *                         typed recall with blanks: blanks right ÷ blanks;
 *                         otherwise the recall quality, 1..5 → 0..1
 * Not counted: self-assessments and post-repair "I understand now" (the
 * student's own report, not a demonstrated answer) and skips (counted apart).
 *
 * A wrong MCQ is not automatically a concept gap: the student's stated reason
 * is authoritative. Misses the student attributes to misreading or a careless
 * mistake are execution slips and never flag the concept as needing work.
 */

export const ANSWER_EVENT_TYPES = ["mcq_attempt", "repair_verification", "review", "skip"] as const;

/** An answer at or above this score counts as right for "needs work" / "recovered". */
export const PASS_SCORE = 0.5;
/** Below this many answers a subject's accuracy is shown as too few to judge. */
export const MIN_ANSWERS_TO_JUDGE = 3;

export type MissCause = "knowledge" | "execution" | "calibration" | "unexplained";

export const MISS_CAUSE_LABEL: Record<MissCause, string> = {
  knowledge: "Did not know or could not recall",
  execution: "Misread or careless",
  calibration: "Guessed or unsure",
  unexplained: "No reason given",
};

const CAUSE_OF: Record<string, MissCause> = {
  concept_not_understood: "knowledge",
  could_not_recall: "knowledge",
  overconfident: "knowledge", // a confidently held wrong fact
  misunderstood_question: "execution",
  careless_mistake: "execution",
  guessed: "calibration",
  not_sure: "calibration",
};

export interface EvidenceEvent {
  conceptId: string;
  eventType: string;
  createdAt: Date | string;
  mcqCorrect: boolean | null;
  qualityRating: number | null;
  eventMetadata: Record<string, unknown> | null;
}

export interface EvidenceConcept {
  id: string;
  name: string;
  subject: string;
}

export interface ScoredAnswer {
  conceptId: string;
  at: number;
  kind: "mcq" | "repair_check" | "written" | "recall";
  score: number;
  /** Only for misses (score < PASS_SCORE). */
  cause: MissCause | null;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Turn one recorded event into a scored answer, or null if it is not an answer. */
export function scoreEvent(e: EvidenceEvent): ScoredAnswer | null {
  const m = e.eventMetadata ?? {};
  const at = new Date(e.createdAt).getTime();
  const reason = typeof m.failureReason === "string" ? m.failureReason : null;
  const miss = (kind: ScoredAnswer["kind"], score: number, cause: MissCause | null): ScoredAnswer => ({
    conceptId: e.conceptId,
    at,
    kind,
    score,
    cause: score < PASS_SCORE ? cause : null,
  });

  switch (e.eventType) {
    case "mcq_attempt": {
      if (e.mcqCorrect === null || e.mcqCorrect === undefined) return null;
      return miss("mcq", e.mcqCorrect ? 1 : 0, reason ? (CAUSE_OF[reason] ?? "unexplained") : "unexplained");
    }
    case "repair_verification": {
      if (typeof m.verificationCorrect !== "boolean") return null;
      // Failing the repair's own check is a knowledge miss: the repair targeted it.
      return miss("repair_check", m.verificationCorrect ? 1 : 0, "knowledge");
    }
    case "review": {
      const written = num(m.writtenScore);
      if (written !== null) {
        const max = num(m.writtenMaxScore) ?? 10;
        return miss("written", Math.max(0, Math.min(1, max > 0 ? written / max : 0)), "knowledge");
      }
      const clozeTotal = num(m.clozeTotal);
      const clozeCorrect = num(m.clozeCorrect);
      if (clozeTotal && clozeTotal > 0 && clozeCorrect !== null) {
        return miss("recall", Math.max(0, Math.min(1, clozeCorrect / clozeTotal)), "knowledge");
      }
      const q = e.qualityRating;
      if (typeof q === "number" && q >= 1 && q <= 5) return miss("recall", (q - 1) / 4, "knowledge");
      return null;
    }
    default:
      return null;
  }
}

export interface ConceptEvidence {
  conceptId: string;
  name: string;
  subject: string;
  answers: number;
  score: number; // sum of answer scores
  misses: number; // answers below PASS_SCORE
  /** Latest answer was a miss not attributed to a slip. */
  needsWork: boolean;
  /** Missed at least once, latest answer right. */
  recovered: boolean;
  latestCause: MissCause | null;
  lastAnsweredAt: number;
}

export interface SubjectEvidence {
  subject: string;
  concepts: number;
  conceptsTested: number;
  answers: number;
  /** Score-weighted accuracy 0..1, or null when there are no answers. */
  accuracy: number | null;
  /** True when answers < MIN_ANSWERS_TO_JUDGE. */
  tooFewToJudge: boolean;
  mcqRight: number;
  mcqTotal: number;
  needsWork: number;
}

export interface EvidenceRecommendation {
  kind: "revise" | "focus" | "test" | "habit";
  text: string;
  conceptId?: string;
  subject?: string;
}

export interface AnswerEvidence {
  totals: {
    answers: number;
    accuracy: number | null;
    conceptsTested: number;
    concepts: number;
    needsWork: number;
    recovered: number;
    skips: number;
  };
  missesByCause: Record<MissCause, number>;
  subjects: SubjectEvidence[];
  needsWork: ConceptEvidence[];
  recommendations: EvidenceRecommendation[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function buildAnswerEvidence(concepts: EvidenceConcept[], events: EvidenceEvent[], subjectOrder: readonly string[] = []): AnswerEvidence {
  const conceptById = new Map(concepts.map((c) => [c.id, c]));
  const answersByConcept = new Map<string, ScoredAnswer[]>();
  const missesByCause: Record<MissCause, number> = { knowledge: 0, execution: 0, calibration: 0, unexplained: 0 };
  let skips = 0;

  for (const e of events) {
    if (!conceptById.has(e.conceptId)) continue;
    if (e.eventType === "skip") {
      skips++;
      continue;
    }
    const a = scoreEvent(e);
    if (!a) continue;
    const list = answersByConcept.get(a.conceptId) ?? [];
    list.push(a);
    answersByConcept.set(a.conceptId, list);
    if (a.cause) missesByCause[a.cause]++;
  }

  const perConcept: ConceptEvidence[] = [];
  for (const [conceptId, list] of answersByConcept) {
    const c = conceptById.get(conceptId)!;
    list.sort((x, y) => x.at - y.at);
    const latest = list[list.length - 1];
    const misses = list.filter((a) => a.score < PASS_SCORE).length;
    const latestMissed = latest.score < PASS_SCORE;
    perConcept.push({
      conceptId,
      name: c.name,
      subject: c.subject,
      answers: list.length,
      score: list.reduce((s, a) => s + a.score, 0),
      misses,
      needsWork: latestMissed && latest.cause !== "execution",
      recovered: !latestMissed && misses > 0,
      latestCause: latestMissed ? latest.cause : null,
      lastAnsweredAt: latest.at,
    });
  }

  const subjectNames = [...new Set([...subjectOrder, ...concepts.map((c) => c.subject)])];
  const subjects: SubjectEvidence[] = subjectNames
    .map((subject) => {
      const inSubject = concepts.filter((c) => c.subject === subject);
      const tested = perConcept.filter((p) => p.subject === subject);
      const answers = tested.reduce((n, p) => n + p.answers, 0);
      const score = tested.reduce((n, p) => n + p.score, 0);
      const mcqs = tested.flatMap((p) => (answersByConcept.get(p.conceptId) ?? []).filter((a) => a.kind === "mcq"));
      return {
        subject,
        concepts: inSubject.length,
        conceptsTested: tested.length,
        answers,
        accuracy: answers > 0 ? score / answers : null,
        tooFewToJudge: answers < MIN_ANSWERS_TO_JUDGE,
        mcqRight: mcqs.filter((a) => a.score === 1).length,
        mcqTotal: mcqs.length,
        needsWork: tested.filter((p) => p.needsWork).length,
      };
    })
    .filter((s) => s.concepts > 0);

  const needsWork = perConcept
    .filter((p) => p.needsWork)
    .sort((a, b) => b.misses - a.misses || b.lastAnsweredAt - a.lastAnsweredAt);

  const totalAnswers = perConcept.reduce((n, p) => n + p.answers, 0);
  const totalScore = perConcept.reduce((n, p) => n + p.score, 0);

  return {
    totals: {
      answers: totalAnswers,
      accuracy: totalAnswers > 0 ? totalScore / totalAnswers : null,
      conceptsTested: perConcept.length,
      concepts: concepts.length,
      needsWork: needsWork.length,
      recovered: perConcept.filter((p) => p.recovered).length,
      skips,
    },
    missesByCause,
    subjects,
    needsWork,
    recommendations: recommend(subjects, needsWork, missesByCause),
  };
}

function recommend(subjects: SubjectEvidence[], needsWork: ConceptEvidence[], causes: Record<MissCause, number>): EvidenceRecommendation[] {
  const out: EvidenceRecommendation[] = [];

  for (const c of needsWork.slice(0, 3)) {
    out.push({
      kind: "revise",
      conceptId: c.conceptId,
      subject: c.subject,
      text:
        c.misses > 1
          ? `Revise ${c.name}: missed ${c.misses} times and not yet answered correctly since.`
          : `Revise ${c.name}: your last answer on it was wrong.`,
    });
  }

  const judged = subjects.filter((s) => !s.tooFewToJudge && s.accuracy !== null).sort((a, b) => a.accuracy! - b.accuracy!);
  const weakest = judged[0];
  if (weakest && weakest.accuracy! < 0.6) {
    out.push({
      kind: "focus",
      subject: weakest.subject,
      text: `Focus on ${weakest.subject}: ${pct(weakest.accuracy!)} correct across ${weakest.answers} answers.`,
    });
  }

  const untested = subjects.filter((s) => s.answers === 0).sort((a, b) => b.concepts - a.concepts)[0];
  if (untested) {
    out.push({
      kind: "test",
      subject: untested.subject,
      text: `Test yourself on ${untested.subject}: ${untested.concepts} concept${untested.concepts === 1 ? "" : "s"} studied, no answers yet.`,
    });
  }

  const totalMisses = causes.knowledge + causes.execution + causes.calibration + causes.unexplained;
  if (causes.execution >= 3 && causes.execution / Math.max(1, totalMisses) >= 0.25) {
    out.push({
      kind: "habit",
      text: `Slow down on statement questions: ${causes.execution} wrong answers were slips you put down to misreading or carelessness.`,
    });
  } else if (causes.calibration >= 3 && causes.calibration / Math.max(1, totalMisses) >= 0.25) {
    out.push({
      kind: "habit",
      text: `${causes.calibration} wrong answers were guesses. Practise elimination before choosing an option.`,
    });
  }

  return out.slice(0, 5);
}
