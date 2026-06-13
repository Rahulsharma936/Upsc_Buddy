/**
 * Concept normalization utilities.
 * Transforms raw AI-extracted concept names into clean, canonical forms.
 * 
 * "Federal Structure", "Indian Federalism", "federalism"
 * all normalize to → "federalism" (normalized), "Federalism" (display)
 */

// ─── Name Normalization ─────────────────────────────────────

/**
 * Produce a normalized key for deduplication and comparison.
 * Deterministic: same input always produces same output.
 */
export function normalizeConceptName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    // Collapse whitespace
    .replace(/\s+/g, " ")
    // Remove possessives
    .replace(/'s\b/g, "")
    // Remove punctuation except hyphens between words
    .replace(/[^\w\s-]/g, "")
    // Remove leading/trailing hyphens
    .replace(/^-+|-+$/g, "")
    // Remove common noise prefixes
    .replace(/^(the|a|an)\s+/i, "")
    // Remove "of india" / "in india" suffixes for normalization
    .replace(/\s+(of|in)\s+india$/i, "")
    .trim();
}

/**
 * Produce a clean display name from raw AI output.
 * Preserves casing intent but cleans formatting.
 */
export function toDisplayName(raw: string): string {
  return raw
    .trim()
    // Collapse whitespace
    .replace(/\s+/g, " ")
    // Remove leading/trailing punctuation
    .replace(/^[^\w]+|[^\w]+$/g, "")
    // Title case if all lowercase
    .replace(/^[a-z]/, (c) => c.toUpperCase());
}

// ─── Keyword Normalization ──────────────────────────────────

/**
 * Clean and deduplicate keywords.
 */
export function normalizeKeywords(raw: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const kw of raw) {
    const cleaned = kw
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[^\w\s-]/g, "");

    if (cleaned.length > 0 && !seen.has(cleaned)) {
      seen.add(cleaned);
      // Store with first letter capitalized
      result.push(cleaned.charAt(0).toUpperCase() + cleaned.slice(1));
    }
  }

  return result;
}
