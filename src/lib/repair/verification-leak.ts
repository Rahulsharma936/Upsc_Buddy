/**
 * Verification leak detection — pure.
 *
 * A repair's verification question is a giveaway when its correct option is
 * stated in the text the repair just showed the student, while none of the
 * distractors are. Example: the reveal says "Chhattisgarh has iron ore and
 * coal", then asks "Which state produces iron ore and coal?" with
 * Chhattisgarh as the answer. That checks reading, not understanding.
 */

export interface VerificationLike {
  options: { a: string; b: string; c: string; d: string };
  correctAnswer: string;
}

const MIN_TERM_LENGTH = 4;

/**
 * UPSC answer-format options ("Only two", "1 and 3 only", "Both 1 and 2",
 * "Neither 1 nor 2", "Statement-I is correct…") carry no content, so they can
 * never leak an answer even when the same words appear in the explanation.
 */
const FORMAT_OPTION = /^(?:(?:only|all|both|neither|nor|none|and|of|the|above|one|two|three|four|five|statement|statements|is|are|correct|incorrect|i|ii|iii|iv|\d+)\s*)+$/;

export function isFormatOption(option: string): boolean {
  return FORMAT_OPTION.test(normalizeForLeak(option));
}

/** Lowercase, alphanumerics and single spaces only. */
export function normalizeForLeak(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Collect every string in a repair payload except the verification object,
 * i.e. everything the student sees before answering the verification.
 */
export function collectShownText(repair: unknown): string {
  const parts: string[] = [];
  const walk = (v: unknown, key: string | null) => {
    if (key === "verification") return;
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) v.forEach((x) => walk(x, null));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        // Identifiers and enums are never shown as content.
        if (["requestId", "conceptId", "failureReason", "repairIntent", "status"].includes(k)) continue;
        walk(x, k);
      }
    }
  };
  walk(repair, null);
  return parts.join(" \n ");
}

/**
 * Returns the leaked answer text when the verification is a giveaway, or null.
 * Leaky = the correct option (normalised, ≥ 4 chars) appears in the shown text
 * AND no distractor does. Statement-count options ("Only two") never leak.
 */
export function findVerificationLeak(shownText: string, verification: VerificationLike | null | undefined): string | null {
  if (!verification) return null;
  const key = verification.correctAnswer as keyof VerificationLike["options"];
  const correct = verification.options?.[key];
  if (typeof correct !== "string") return null;
  if (isFormatOption(correct)) return null;

  const shown = ` ${normalizeForLeak(shownText)} `;
  const correctNorm = normalizeForLeak(correct);
  if (correctNorm.length < MIN_TERM_LENGTH) return null;
  if (!shown.includes(` ${correctNorm} `)) return null;

  const distractorShown = (["a", "b", "c", "d"] as const)
    .filter((k) => k !== key)
    .map((k) => normalizeForLeak(verification.options[k] ?? ""))
    .some((d) => d.length >= MIN_TERM_LENGTH && shown.includes(` ${d} `));

  return distractorShown ? null : correct;
}
