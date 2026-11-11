/**
 * Repair guidance injected into every repair executor's prompt.
 *
 * Two jobs, both pure text:
 *   1. Ground the repair in the student's EXISTING Knowledge note, so a
 *      repair never contradicts what they will revise from later.
 *   2. Hold the verification question to UPSC Prelims standard and stop it
 *      from being answerable by repeating what the repair just showed.
 *
 * No DB, no AI. The route fetches the note; this only formats text.
 */

export interface RepairNoteGrounding {
  coreIdea: string;
  memoryHooks: string[];
  examTriggers: string[];
  /**
   * Set by the route when a previous attempt's verification was a giveaway:
   * these answers were stated in the repair text and must not be used.
   */
  avoidAnswers?: string[];
  /** Concepts adjacent to this one (concept graph / shared terms) — test one of these. */
  adjacentTopics?: string[];
  /** Real UPSC PYQs matched to this concept — the dimensions UPSC actually examines. */
  examinedPyqs?: string[];
  /** Questions the check must not repeat (the recall prompt, the missed question). */
  avoidQuestions?: string[];
}

const MAX_LIST_ITEMS = 4;
const MAX_CORE_IDEA_CHARS = 800;

/**
 * The bar every repair verification question must clear. Applies to the
 * "verification" object in each executor's JSON and overrides any simpler
 * wording an individual executor uses for it.
 */
export const VERIFICATION_STANDARD = `
VERIFICATION QUESTION STANDARD (applies to the "verification" object; overrides any simpler instruction about it below)
- Write it at UPSC Prelims standard, intermediate to advanced difficulty.
- Prefer the current UPSC formats: "Consider the following statements: 1. ... 2. ... 3. ... How many of the above statements are correct?" with options "Only one", "Only two", "All three", "None"; or "Statement-I / Statement-II" with the four standard options; or "How many of the above pairs are correctly matched?".
- It must NOT be answerable by repeating what this repair shows the student. Test an adjacent fact, an exception, a qualifier, an application, or a distinction the student has to reason out.
- The correct option's wording must NOT appear anywhere in the explanation, answer or breakdown you return above it.
- No single-fact recall ("Which state…", "Which article…") with one-word options. No "All of the above". Every distractor must be something a well-prepared aspirant could plausibly believe.
- The explanation must justify every statement or option, not only the correct one.
`;

/**
 * Format the guidance block inserted in each executor's REPAIR TARGET section.
 * Always contains the verification standard; adds the student's note when one
 * exists, and an explicit ban when a previous verification leaked its answer.
 */
export function formatRepairGuidance(note: RepairNoteGrounding | null | undefined): string {
  return VERIFICATION_STANDARD + formatNoteGrounding(note);
}

/**
 * The student's note (and any banned answers) without the verification
 * standard. Used by the clarification executor, which asks no verification
 * question and must not be told about one.
 */
export function formatNoteGrounding(note: RepairNoteGrounding | null | undefined): string {
  let block = "";

  if (note) {
    const coreIdea = note.coreIdea.trim().slice(0, MAX_CORE_IDEA_CHARS);
    const hooks = note.memoryHooks.filter((h) => h.trim().length > 0).slice(0, MAX_LIST_ITEMS);
    const triggers = note.examTriggers.filter((t) => t.trim().length > 0).slice(0, MAX_LIST_ITEMS);

    if (coreIdea || hooks.length > 0 || triggers.length > 0) {
      block += `
STUDENT'S EXISTING NOTE (the student's own revision note — use it for scope and consistency, do not restate it wholesale. It may contain errors: factual accuracy overrides it. If a note fact is wrong, correct it explicitly instead of repeating it.)`;
      if (coreIdea) block += `
Core idea: ${coreIdea}`;
      if (hooks.length > 0) block += `
Memory hooks: ${hooks.join(" | ")}`;
      if (triggers.length > 0) block += `
Exam triggers: ${triggers.join(" | ")}`;
      block += `
`;
    }

    const adjacent = (note.adjacentTopics ?? []).map((a) => a.trim()).filter(Boolean).slice(0, 5);
    if (adjacent.length > 0) {
      block += `
ADJACENT TOPICS — the verification question should test one of these (or another sub-topic the repair touched), NOT re-ask the repair's own question: ${adjacent.join(" | ")}
`;
    }
    const pyqs = (note.examinedPyqs ?? []).map((a) => a.trim()).filter(Boolean).slice(0, 3);
    if (pyqs.length > 0) {
      block += `
HOW UPSC HAS EXAMINED THIS (real previous-year questions — target these dimensions, do not copy them):
${pyqs.map((p) => `- ${p.slice(0, 300)}`).join("\n")}
`;
    }
    const avoidQ = (note.avoidQuestions ?? []).map((a) => a.trim()).filter(Boolean).slice(0, 3);
    if (avoidQ.length > 0) {
      block += `
DO NOT REPEAT these questions or close paraphrases of them as the verification: ${avoidQ.map((q) => `"${q.slice(0, 200)}"`).join(" ; ")}
`;
    }

    const avoid = (note.avoidAnswers ?? []).map((a) => a.trim()).filter(Boolean).slice(0, 3);
    if (avoid.length > 0) {
      block += `
PREVIOUS ATTEMPT REJECTED: its verification answer (${avoid.map((a) => `"${a}"`).join(", ")}) was stated in the repair text, so the question was a giveaway. Write a different verification question whose answer is not stated anywhere above it.
`;
    }
  }

  return block;
}
