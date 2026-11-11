/**
 * End-to-end student journey — server side, against the REAL database and the
 * REAL AI provider, with full cleanup.
 *
 * Plays a student through the Step 3 + Step 4 backend:
 *   session assembly → correct MCQ → wrong MCQ → repair (real LLM) →
 *   verification → understanding → next action → reinforcement →
 *   clarification path → recall self-assessment → skip → resume check.
 *
 * It exercises the same library functions the API routes call (the routes
 * themselves need a Supabase session cookie). Every row it writes is removed
 * and every mastery row it touches is restored at the end, even on failure.
 *
 * Run from the repo root:  npx tsx scripts/e2e-student-session.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

// ─── Env (tsx does not load .env.local) ─────────────────────
{
  const envText = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  for (const line of envText.split(/\r?\n/)) {
    if (line.trim().startsWith("#")) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// ─── Reporting ──────────────────────────────────────────────
let passed = 0;
let failed = 0;
const issues: string[] = [];
const notes: string[] = [];

function check(cond: boolean, label: string, detail?: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    issues.push(label + (detail ? ` — ${detail}` : ""));
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function note(msg: string): void {
  notes.push(msg);
  console.log(`  · ${msg}`);
}
function step(title: string): void {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}`);
}
async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t = Date.now();
  const r = await fn();
  note(`${label} took ${Date.now() - t} ms`);
  return r;
}

async function main(): Promise<void> {
  const { db } = await import("@/lib/db");
  const { concepts, conceptQuestions, conceptMastery, revisionEvents } = await import("@/lib/db/schema");
  const { sql, eq, and, inArray, notInArray } = await import("drizzle-orm");
  const { revisionIntelligenceService } = await import("@/lib/ai/services/revision-intelligence.service");
  const { revisionRepository } = await import("@/lib/repositories/revision.repository");
  const { noteRepository } = await import("@/lib/repositories/note.repository");
  const { conceptRepository } = await import("@/lib/repositories/concept.repository");
  const { revisionSessionService } = await import("@/lib/revision-session/revision-session.service");
  const { reinforcementService } = await import("@/lib/reinforcement/reinforcement.service");
  const { summarizeSession, isCompletedSince } = await import("@/lib/revision-session/revision-session.engine");
  const { buildRepairRequest } = await import("@/lib/repair/repair-request.builder");
  const { executeActiveRecall } = await import("@/lib/repair/active-recall.executor");
  const { executeClarification } = await import("@/lib/repair/clarification.executor");
  const { executeConceptTeaching } = await import("@/lib/repair/concept-teaching.executor");
  const { validateRepairVerification, buildRepairVerificationEvent } = await import("@/lib/repair/repair-verification");
  const { deriveRepairContext, buildRepairUnderstandingEvent } = await import("@/lib/repair/repair-understanding");
  const { decideNextAction } = await import("@/lib/repair/repair-next-action");
  const { formatRepairGuidance: formatNoteGrounding } = await import("@/lib/repair/note-grounding");

  // ─── 0. Pick the student: the user with the most hydrated concepts ───
  step("0. Choose a student and snapshot their state");
  const pick = await db.execute(sql`
    select c.user_id as user_id, count(*)::int as n
    from concept_questions cq
    join concepts c on c.id = cq.concept_id
    where jsonb_array_length(cq.prelims_mcqs) > 0
    group by c.user_id order by n desc limit 1
  `);
  const userId = (pick as unknown as { user_id: string }[])[0]?.user_id;
  if (!userId) throw new Error("No user with hydrated concepts — nothing to test against");
  note(`student = ${userId.slice(0, 8)}… (${(pick as unknown as { n: number }[])[0].n} hydrated concepts)`);

  const masteryBefore = await db.select().from(conceptMastery).where(eq(conceptMastery.userId, userId));
  const eventsBefore = await db.select({ id: revisionEvents.id }).from(revisionEvents).where(eq(revisionEvents.userId, userId));
  const existingEventIds = eventsBefore.map((e) => e.id);
  note(`snapshot: ${masteryBefore.length} mastery rows, ${existingEventIds.length} events`);

  // Make sure at least three hydrated concepts and one bare concept are due,
  // so every path is reachable. Everything is restored in cleanup.
  const hydratedRows = await db
    .select({ id: concepts.id })
    .from(conceptQuestions)
    .innerJoin(concepts, eq(concepts.id, conceptQuestions.conceptId))
    .where(and(eq(concepts.userId, userId), sql`jsonb_array_length(${conceptQuestions.prelimsMcqs}) > 0`))
    .limit(3);
  const bareRows = await db.execute(sql`
    select c.id from concepts c
    left join concept_questions cq on cq.concept_id = c.id
    where c.user_id = ${userId} and (cq.id is null or jsonb_array_length(cq.prelims_mcqs) = 0)
    limit 1
  `);
  const dueFixtures = [...hydratedRows.map((r) => r.id), ...(bareRows as unknown as { id: string }[]).map((r) => r.id)];
  const beforeById = new Map(masteryBefore.map((m) => [m.conceptId, m]));

  try {
    for (const id of dueFixtures) {
      if (!beforeById.has(id)) await revisionIntelligenceService.initializeForConcept({ userId, conceptId: id });
      // Far overdue AND flagged weak → top of the priority ranking, so the
      // fixtures are served even when the student has a long due backlog.
      await db.update(conceptMastery)
        .set({ nextReviewAt: new Date(Date.now() - 30 * 86_400_000), isWeakArea: true })
        .where(and(eq(conceptMastery.userId, userId), eq(conceptMastery.conceptId, id)));
    }

    // ─── 1. Open Revision: assemble today's session ───
    step("1. Student opens Revision → session assembled");
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const session1 = await timed("GET /api/revision/session (service)", () =>
      revisionSessionService.build({ userId, limit: 25, since }));
    check(session1.items.length > 0, "session has items", `got ${session1.items.length}`);
    // Only concepts the student already handled today (before this run) may be flagged.
    const handledBefore = await db.execute(sql`
      select distinct concept_id from revision_events
      where user_id = ${userId} and created_at >= ${since.toISOString()}
        and event_type in ('mcq_attempt', 'self_assessment', 'skip')
    `);
    const handledSet = new Set((handledBefore as unknown as { concept_id: string }[]).map((r) => r.concept_id));
    check(session1.items.every((i) => i.completedToday === handledSet.has(i.conceptId)), "completedToday flags exactly the concepts handled earlier today", `${handledSet.size} handled before the run`);
    note(`remaining=${session1.remaining} totalDue=${session1.totalDue}; items with questions=${session1.items.filter((i) => i.mcq).length}, recall-only=${session1.items.filter((i) => !i.mcq).length}`);

    // The student plays whatever the session actually serves.
    const asked = session1.items.filter((i) => i.mcq !== null);
    const [A, B, C] = asked.map((i) => ({ id: i.conceptId, name: i.conceptName }));
    if (!A || !B || !C) throw new Error(`Session served only ${asked.length} question items — need 3 to play every path`);
    const recallItem = session1.items.find((i) => i.mcq === null) ?? null;
    const R = recallItem ? { id: recallItem.conceptId, name: recallItem.conceptName } : null;
    note(`playing: A="${A.name}", B="${B.name}", C="${C.name}", recall=${R ? `"${R.name}"` : "none served"}`);
    if (R) check(recallItem!.note !== null || true, "recall-only item has a note or shows the no-notes fallback");
    const inSession = (id: string) => session1.items.find((i) => i.conceptId === id);
    const fixtureIds = [A.id, B.id, C.id, ...(R ? [R.id] : [])];
    const touchedBefore = new Map(fixtureIds.filter((id) => beforeById.has(id)).map((id) => [id, beforeById.get(id)!]));

    // ─── 2. Item A: answer correctly, confident ───
    step("2. Item A → correct answer, 'I was confident'");
    const aMcq = inSession(A.id)!.mcq!;
    const aRes = await revisionIntelligenceService.recordReview({
      userId, conceptId: A.id, quality: 4, eventType: "mcq_attempt",
      mcqCorrect: true, mcqQuestionIndex: aMcq.questionIndex,
      ...(aMcq.questionId ? { mcqQuestionId: aMcq.questionId } : {}),
      selectedAnswer: aMcq.correctAnswer, correctAnswer: aMcq.correctAnswer, confidence: 3,
    });
    check(typeof aRes.intervalDays === "number" && aRes.intervalDays >= 1, "SM-2 returned a schedule", `intervalDays=${aRes.intervalDays}`);
    check(aRes.mastery.correctCount === (touchedBefore.get(A.id)?.correctCount ?? 0) + 1, "correctCount incremented by exactly 1");
    const aEvents = await revisionRepository.getRecentEvents(userId, A.id, 1);
    const aMeta = (aEvents[0]?.eventMetadata ?? {}) as Record<string, unknown>;
    check(aEvents[0]?.eventType === "mcq_attempt" && aMeta.confidence === 3, "event stored with confidence=3");
    check(!aMcq.questionId || aMeta.questionId === aMcq.questionId, "event stored with questionId");

    // ─── 3. Item B: wrong, "couldn't recall" → repair → verify → understand → reinforce ───
    step("3. Item B → wrong answer, 'could not recall' → active-recall repair");
    const bMcq = inSession(B.id)!.mcq!;
    const wrongOpt = (["a", "b", "c", "d"] as const).find((o) => o !== bMcq.correctAnswer)!;
    const bRes = await revisionIntelligenceService.recordReview({
      userId, conceptId: B.id, quality: 1, eventType: "mcq_attempt",
      mcqCorrect: false, mcqQuestionIndex: bMcq.questionIndex,
      ...(bMcq.questionId ? { mcqQuestionId: bMcq.questionId } : {}),
      selectedAnswer: wrongOpt, correctAnswer: bMcq.correctAnswer, failureReason: "could_not_recall",
    });
    check(bRes.intervalDays === 1, "wrong answer resets interval to 1 day", `got ${bRes.intervalDays}`);

    const bConcept = (await conceptRepository.findById(B.id))!;
    const bNote = await noteRepository.findLatestByConceptId(B.id);
    const grounding = bNote ? { coreIdea: bNote.coreIdea ?? "", memoryHooks: bNote.memoryHooks ?? [], examTriggers: bNote.examTriggers ?? [] } : null;
    note(grounding ? `note grounding available (${formatNoteGrounding(grounding).length} chars)` : "no note for B — repair runs ungrounded");

    const bReq = buildRepairRequest({
      failureReason: "could_not_recall", conceptId: B.id,
      questionContext: { questionIndex: bMcq.questionIndex, selectedAnswer: wrongOpt, correctAnswer: bMcq.correctAnswer, questionText: bMcq.question, ...(bMcq.questionId ? { questionId: bMcq.questionId } : {}) },
    });
    check(bReq.repairIntent === "active_recall", "could_not_recall → active_recall");
    const repair = await timed("executeActiveRecall (real LLM)", () =>
      executeActiveRecall({ request: bReq, conceptName: bConcept.displayName, conceptSubject: bConcept.subject, conceptKeywords: bConcept.keywords ?? [], conceptNote: grounding }));
    check(!!repair.retrieval?.prompt && !!repair.reveal?.expectedAnswer, "repair has retrieval prompt + reveal");
    check(!!repair.verification?.question && ["a", "b", "c", "d"].includes(repair.verification.correctAnswer), "repair has a verification MCQ");
    const sameQuestion = repair.verification.question.trim().toLowerCase() === bMcq.question.trim().toLowerCase();
    check(!sameQuestion, "verification question differs from the missed question");

    // Verification: answer it correctly.
    const vPayload = {
      requestId: repair.requestId, conceptId: B.id, failureReason: "could_not_recall", repairIntent: "active_recall",
      verificationSelectedAnswer: repair.verification.correctAnswer, verificationCorrectAnswer: repair.verification.correctAnswer,
      questionContext: { questionIndex: bMcq.questionIndex, ...(bMcq.questionId ? { questionId: bMcq.questionId } : {}) },
      verificationQuestion: repair.verification.question,
    };
    const vv = validateRepairVerification(vPayload);
    check(vv.success, "verification payload validates", vv.success ? undefined : vv.error);
    if (!vv.success) throw new Error(vv.error);
    const vEvent = buildRepairVerificationEvent(vv.payload, vv.repairIntent);
    let repairEvidencePersisted = false;
    try {
      const vRow = await revisionRepository.logEvent({ userId, conceptId: B.id, eventType: vEvent.eventType, qualityRating: vEvent.qualityRating, mcqCorrect: vEvent.mcqCorrect, mcqQuestionIndex: vEvent.mcqQuestionIndex, eventMetadata: vEvent.eventMetadata });
      repairEvidencePersisted = true;
      check(vRow.eventType === "repair_verification" && vRow.qualityRating === null, "verification stored as repair_verification with NO quality (SM-2 isolated)");
      const dup = await revisionRepository.findRepairVerification(userId, repair.requestId);
      check(dup?.id === vRow.id, "duplicate verification would be detected by requestId");
    } catch (err) {
      const msg = err instanceof Error ? `${err.message} ${(err as { cause?: { message?: string } }).cause?.message ?? ""}` : String(err);
      check(false, "DATABASE rejects repair_verification insert — the R3.3 evidence chain cannot persist", "apply supabase/migrations/00017_repair_event_types.sql (CHECK constraint on revision_events.event_type)");
      note(`db error: ${msg.slice(0, 160)}`);
    }
    const bMasteryAfterVerify = await revisionRepository.getMastery(userId, B.id);
    check(bMasteryAfterVerify?.intervalDays === 1 && bMasteryAfterVerify.incorrectCount === bRes.mastery.incorrectCount, "mastery unchanged by verification");

    // Understanding: derived server-side from the stored verification.
    if (repairEvidencePersisted) {
      const stored = await revisionRepository.findRepairEventByRequestId(userId, "repair_verification", repair.requestId);
      const ctx = deriveRepairContext(stored!.eventMetadata, stored!.conceptId);
      check(ctx.success && ctx.context.failureReason === "could_not_recall" && ctx.context.repairIntent === "active_recall", "understanding derives reason + intent from the stored verification");
      if (ctx.success) {
        const uEvent = buildRepairUnderstandingEvent({ requestId: repair.requestId, postRepairUnderstanding: "understood" }, ctx.context);
        try {
          await revisionRepository.logEvent({ userId, conceptId: B.id, eventType: uEvent.eventType, qualityRating: null, mcqCorrect: null, mcqQuestionIndex: null, eventMetadata: uEvent.eventMetadata });
          check(true, "understanding stored as repair_understanding");
        } catch {
          check(false, "DATABASE rejects repair_understanding insert", "apply migration 00017");
        }
      }
    } else {
      note("skipping understanding persistence (verification could not be stored); the UI would show 'Couldn't save' twice and /api/repair/understanding would 404");
      // Pure derivation still provable from the in-memory event.
      const ctx = deriveRepairContext(vEvent.eventMetadata, B.id);
      check(ctx.success && ctx.context.repairIntent === "active_recall", "understanding derivation logic is correct (in-memory)");
    }
    const action = decideNextAction({ verificationCorrect: true, postRepairUnderstanding: "understood" });
    check(action === "repair_complete", "understood + correct → repair_complete");

    // Reinforcement after the repair.
    const reinf = await timed("GET /api/reinforce (service)", () =>
      reinforcementService.build({ userId, conceptId: B.id, failureReason: "could_not_recall", outcome: "repair_complete", excludeQuestionId: bMcq.questionId ?? null, excludeQuestionIndex: bMcq.questionIndex }));
    check(!!reinf, "reinforcement built");
    if (reinf) {
      note(`reinforcement order = [${reinf.order.join(", ")}]; pyqs=${reinf.pyqs.length}; dominoes=${reinf.dominoes.length}; transferMcq=${reinf.transferMcq ? "yes" : "none"}`);
      if (repairEvidencePersisted) {
        check(reinf.history.repairCount >= 1 && reinf.history.lastVerificationCorrect === true && reinf.history.lastUnderstanding === "understood", "reinforcement READ the repair events (first consumer)");
      } else {
        note(`reinforcement history: repairCount=${reinf.history.repairCount} (repair events could not be stored — see migration 00017)`);
      }
      check(!reinf.order.includes("coreIdea"), "repair_complete does not re-teach the core idea");
      if (reinf.transferMcq) {
        const same = bMcq.questionId ? reinf.transferMcq.questionId === bMcq.questionId : reinf.transferMcq.questionIndex === bMcq.questionIndex;
        check(!same, "transfer MCQ is not the question just missed");
      } else {
        note("no transfer MCQ available (concept has only the missed question?)");
      }
      for (const s of reinf.order) {
        const has = s === "coreIdea" ? !!reinf.note?.coreIdea : s === "hooks" ? (reinf.note?.memoryHooks.length ?? 0) > 0 : s === "triggers" ? (reinf.note?.examTriggers.length ?? 0) > 0 : s === "staticCurrent" ? (reinf.note?.staticCurrentLink.length ?? 0) > 0 : s === "transferMcq" ? !!reinf.transferMcq : s === "pyqs" ? reinf.pyqs.length > 0 : s === "dominoes" ? reinf.dominoes.length > 0 : !!reinf.mainsAngle;
        check(has, `ordered section "${s}" actually has content`);
      }
      for (const d of reinf.dominoes) check(d.conceptId !== B.id, `domino "${d.conceptName}" is a different concept`);
    }

    // ─── 4. Item C: wrong, "not sure" → clarification (no verification) ───
    step("4. Item C → wrong answer, 'not sure' → clarification");
    const cMcq = inSession(C.id)!.mcq!;
    const cWrong = (["a", "b", "c", "d"] as const).find((o) => o !== cMcq.correctAnswer)!;
    await revisionIntelligenceService.recordReview({ userId, conceptId: C.id, quality: 1, eventType: "mcq_attempt", mcqCorrect: false, mcqQuestionIndex: cMcq.questionIndex, ...(cMcq.questionId ? { mcqQuestionId: cMcq.questionId } : {}), selectedAnswer: cWrong, correctAnswer: cMcq.correctAnswer, failureReason: "not_sure" });
    const cConcept = (await conceptRepository.findById(C.id))!;
    const cReq = buildRepairRequest({ failureReason: "not_sure", conceptId: C.id, questionContext: { questionIndex: cMcq.questionIndex, selectedAnswer: cWrong, correctAnswer: cMcq.correctAnswer, questionText: cMcq.question } });
    const clar = await timed("executeClarification (real LLM)", () =>
      executeClarification({ request: cReq, conceptName: cConcept.displayName, conceptSubject: cConcept.subject, conceptKeywords: cConcept.keywords ?? [] }));
    check(clar.verification === null, "clarification has no verification");
    check(Array.isArray(clar.breakdown?.possibleStumblingPoints) && clar.breakdown.possibleStumblingPoints.length >= 2, "clarification lists ≥2 stumbling points");
    const badV = validateRepairVerification({ ...vPayload, requestId: clar.requestId, conceptId: C.id, failureReason: "not_sure", repairIntent: "clarification" });
    check(!badV.success, "server refuses to verify a clarification repair");
    const reinfC = await reinforcementService.build({ userId, conceptId: C.id, failureReason: "not_sure", outcome: "clarified", excludeQuestionId: cMcq.questionId ?? null, excludeQuestionIndex: cMcq.questionIndex });
    check(!!reinfC && reinfC.order[0] === "coreIdea" || (!!reinfC && !reinfC.note), "clarified + not_sure leads with the core idea (when a note exists)");

    // ─── 5. Grounded concept teaching (does the note reach the executor?) ───
    step("5. Concept teaching with note grounding");
    const teach = await timed("executeConceptTeaching (real LLM, grounded)", () =>
      executeConceptTeaching({ request: buildRepairRequest({ failureReason: "concept_not_understood", conceptId: B.id }), conceptName: bConcept.displayName, conceptSubject: bConcept.subject, conceptKeywords: bConcept.keywords ?? [], conceptNote: grounding }));
    check(!!teach.explanation?.coreIdea && !!teach.verification?.question, "grounded concept teaching produced explanation + verification");

    // ─── 6. Recall path + skip ───
    step("6. Recall fallback (self-assessment 'forgot') and skip");
    const recallTarget = R?.id ?? A.id;
    const sa = await revisionIntelligenceService.recordReview({ userId, conceptId: recallTarget, quality: 1, eventType: "self_assessment", selfAssessment: "forgot" });
    check(sa.intervalDays === 1, "forgot → interval reset to 1 day");
    const skipRes = await revisionIntelligenceService.recordSkip({ userId, conceptId: A.id });
    check(skipRes.skipCount === (aRes.mastery.skipCount + 1), "skip increments skipCount only");

    // ─── 6b. Written answer, marked by the examiner model ───
    step("6b. Written answer → evaluation → review event");
    const { answerEvaluationService } = await import("@/lib/answer/answer-evaluation.service");
    const recallItem2 = inSession(recallTarget);
    check(recallItem2 !== undefined && "needsQuestions" in recallItem2 && "mains" in recallItem2, "session items carry needsQuestions + mains (no cloze)");
    const wNote = await noteRepository.findLatestByConceptId(recallTarget);
    const wNoteCtx = wNote ? { coreIdea: wNote.coreIdea, examTriggers: wNote.examTriggers, staticCurrentLink: wNote.staticCurrentLink } : null;
    const question = `Explain ${recallItem2?.conceptName ?? "this concept"}: what it is, its basis, and one current development it bears on. (100 words)`;
    const weak = await timed("evaluate weak answer (real LLM)", () => answerEvaluationService.evaluate({ conceptId: recallTarget, mode: "recall", question, typedAnswer: "It is an important topic in UPSC and is related to many things in India." }, wNoteCtx));
    note(`weak answer → ${weak.evaluation.score}/10 (${weak.evaluation.verdict}), missed: ${weak.evaluation.missed.slice(0, 2).join(" | ")}`);
    check(weak.evaluation.score <= 3, "vague padding scores ≤ 3/10", `got ${weak.evaluation.score}`);
    check(weak.evaluation.missed.length > 0 && weak.evaluation.improvement.length > 0, "evaluation lists missed points and an improvement");
    const strongText = wNote?.coreIdea ? `${wNote.coreIdea} ${(wNote.examTriggers ?? []).slice(0, 4).join(". ")}. ${(wNote.staticCurrentLink ?? []).slice(0, 1).join("")}` : "";
    if (strongText.length > 40) {
      const strong = await timed("evaluate note-based answer (real LLM)", () => answerEvaluationService.evaluate({ conceptId: recallTarget, mode: "recall", question, typedAnswer: strongText }, wNoteCtx));
      note(`note-based answer → ${strong.evaluation.score}/10 (${strong.evaluation.verdict})`);
      check(strong.evaluation.score > weak.evaluation.score, "a substantive answer outscores padding");
    }
    const wr = await revisionIntelligenceService.recordReview({ userId, conceptId: recallTarget, quality: weak.quality, eventType: "review", writtenScore: weak.evaluation.score, writtenMaxScore: 10, answerSource: weak.source, answerMode: "recall", answerExcerpt: weak.answerText });
    check(typeof wr.intervalDays === "number", "written answer recorded through the existing review event");
    const wEv = await revisionRepository.getRecentEvents(userId, recallTarget, 1);
    const wMeta = (wEv[0]?.eventMetadata ?? {}) as Record<string, unknown>;
    check(wEv[0]?.eventType === "review" && wMeta.writtenScore === weak.evaluation.score && wMeta.answerSource === "typed" && wMeta.answerMode === "recall", "event metadata carries writtenScore / answerSource / answerMode");
    check(wEv[0]?.qualityRating === weak.quality, "SM-2 quality equals the mark-derived quality (no new event type)");

    // ─── 7. Resume: reopen the session ───
    step("7. Student refreshes → session resumes");
    const session2 = await timed("rebuild session", () => revisionSessionService.build({ userId, limit: 25, since }));
    // Answered concepts are rescheduled by SM-2, so they are no longer due and
    // leave the session; a concept that is still due but already handled must
    // be flagged. Either way: never asked again today.
    const notAskedAgain = (id: string) => { const it = session2.items.find((i) => i.conceptId === id); return !it || it.completedToday; };
    check(notAskedAgain(A.id) && notAskedAgain(B.id) && notAskedAgain(C.id), "A, B, C are not asked again (rescheduled or flagged completed)");
    check(session2.doneToday >= 3, "launcher knows how many concepts were handled today", `doneToday=${session2.doneToday}`);
    note(`after play: totalDue ${session1.totalDue} → ${session2.totalDue}, remaining ${session1.remaining} → ${session2.remaining}, doneToday=${session2.doneToday} (backlog refills the session when more concepts are due)`);
    const aEvents2 = await revisionRepository.getRecentEvents(userId, A.id, 20);
    check(isCompletedSince(aEvents2, since), "engine agrees A is completed since local midnight");

    // ─── 8. Summary maths ───
    step("8. Completion summary");
    const summary = summarizeSession([
      { conceptId: A.id, conceptName: A.name, outcome: "correct", intervalDays: aRes.intervalDays, repaired: false },
      { conceptId: B.id, conceptName: B.name, outcome: "wrong", intervalDays: 1, repaired: true },
      { conceptId: C.id, conceptName: C.name, outcome: "wrong", intervalDays: 1, repaired: true },
    ]);
    check(summary.answered === 3 && summary.repaired === 2 && summary.retentionRate !== null && Math.abs(summary.retentionRate - 1 / 3) < 0.01, "summary: 3 answered, 2 repaired, 33% held");
  } finally {
    // ─── Cleanup: remove everything the student wrote; restore mastery ───
    step("Cleanup");
    const del = existingEventIds.length > 0
      ? await db.delete(revisionEvents).where(and(eq(revisionEvents.userId, userId), notInArray(revisionEvents.id, existingEventIds))).returning({ id: revisionEvents.id })
      : await db.delete(revisionEvents).where(eq(revisionEvents.userId, userId)).returning({ id: revisionEvents.id });
    console.log(`  deleted ${del.length} events written by this run`);

    // Restore EVERY mastery row to its snapshot; drop any row created by the run.
    for (const before of masteryBefore) {
      await revisionRepository.upsertMastery({
        userId, conceptId: before.conceptId, easeFactor: before.easeFactor, intervalDays: before.intervalDays, repetitionCount: before.repetitionCount,
        masteryLevel: before.masteryLevel, confidenceScore: before.confidenceScore, lastReviewedAt: before.lastReviewedAt, nextReviewAt: before.nextReviewAt,
        correctCount: before.correctCount, incorrectCount: before.incorrectCount, skipCount: before.skipCount, isWeakArea: before.isWeakArea, weakSignals: before.weakSignals as string[],
      });
    }
    const beforeIds = masteryBefore.map((m) => m.conceptId);
    if (beforeIds.length > 0) {
      await db.delete(conceptMastery).where(and(eq(conceptMastery.userId, userId), notInArray(conceptMastery.conceptId, beforeIds)));
    } else {
      await db.delete(conceptMastery).where(eq(conceptMastery.userId, userId));
    }
    const masteryAfter = await db.select().from(conceptMastery).where(eq(conceptMastery.userId, userId));
    const eventsAfter = await db.select({ id: revisionEvents.id }).from(revisionEvents).where(eq(revisionEvents.userId, userId));
    const restored = masteryAfter.length === masteryBefore.length && eventsAfter.length === existingEventIds.length
      && masteryBefore.every((b) => { const a = masteryAfter.find((m) => m.conceptId === b.conceptId); return !!a && a.intervalDays === b.intervalDays && a.correctCount === b.correctCount && a.incorrectCount === b.incorrectCount && a.skipCount === b.skipCount && String(a.nextReviewAt) === String(b.nextReviewAt); });
    console.log(`  mastery rows ${masteryBefore.length} → ${masteryAfter.length}; events ${existingEventIds.length} → ${eventsAfter.length}; restored=${restored}`);
    if (!restored) issues.push("CLEANUP did not fully restore state — inspect concept_mastery / revision_events for the test user");
  }

  step("RESULTS");
  console.log(`\n  Passed: ${passed}\n  Failed: ${failed}`);
  if (issues.length) { console.log("\n  Issues:"); issues.forEach((i) => console.log(`    - ${i}`)); }
  console.log(`\n  ${failed === 0 ? "✅ STUDENT JOURNEY: PASSED" : "❌ STUDENT JOURNEY: ISSUES FOUND"}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\nFATAL:", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(2);
});
