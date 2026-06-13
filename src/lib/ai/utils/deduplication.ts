/**
 * Concept deduplication utilities.
 * Prevents duplicate concepts within a single extraction and across logs.
 * 
 * Strategies:
 * 1. Normalized-name exact match (within same subject)
 * 2. Keyword overlap detection (>60% overlap = likely duplicate)
 */



interface DeduplicatableItem {
  normalizedName: string;
  originalName: string;
  subject: string;
  keywords: string[];
}

export interface DeduplicationResult<T extends DeduplicatableItem> {
  unique: T[];
  duplicates: Array<{
    item: T;
    reason: string;
    duplicateOf: string;
  }>;
}

/**
 * Deduplicate a list of extracted concepts.
 * Uses normalized name + subject as the primary key.
 * Falls back to keyword overlap detection for near-duplicates.
 */
export function deduplicateConcepts<T extends DeduplicatableItem>(
  items: T[]
): DeduplicationResult<T> {
  const unique: T[] = [];
  const duplicates: DeduplicationResult<T>["duplicates"] = [];

  // Track by normalized_name:subject compound key
  const seen = new Map<string, T>();

  for (const item of items) {
    const compoundKey = `${item.normalizedName}::${item.subject.toLowerCase()}`;

    // Strategy 1: Exact normalized name match within same subject
    if (seen.has(compoundKey)) {
      duplicates.push({
        item,
        reason: "normalized_name_match",
        duplicateOf: seen.get(compoundKey)!.originalName,
      });
      continue;
    }

    // Strategy 2: Keyword overlap check against all previously seen
    const overlapMatch = findKeywordOverlap(item, unique);
    if (overlapMatch) {
      duplicates.push({
        item,
        reason: `keyword_overlap_${Math.round(overlapMatch.overlapRatio * 100)}pct`,
        duplicateOf: overlapMatch.existing.originalName,
      });
      continue;
    }

    seen.set(compoundKey, item);
    unique.push(item);
  }

  return { unique, duplicates };
}

/**
 * Check if an item's keywords overlap >60% with any existing item
 * in the same subject.
 */
function findKeywordOverlap<T extends DeduplicatableItem>(
  candidate: T,
  existing: T[]
): { existing: T; overlapRatio: number } | null {
  if (candidate.keywords.length === 0) return null;

  const candidateKeywords = new Set(
    candidate.keywords.map((k) => k.toLowerCase())
  );

  for (const item of existing) {
    // Only compare within same subject
    if (item.subject.toLowerCase() !== candidate.subject.toLowerCase()) {
      continue;
    }

    if (item.keywords.length === 0) continue;

    const existingKeywords = new Set(
      item.keywords.map((k) => k.toLowerCase())
    );

    let overlap = 0;
    for (const kw of candidateKeywords) {
      if (existingKeywords.has(kw)) overlap++;
    }

    const overlapRatio = overlap / Math.min(candidateKeywords.size, existingKeywords.size);

    if (overlapRatio > 0.6) {
      return { existing: item, overlapRatio };
    }
  }

  return null;
}

/**
 * Filter out concepts whose normalized names already exist in the database
 * for a given user + daily log combination.
 */
export function filterAgainstExisting<T extends DeduplicatableItem>(
  candidates: T[],
  existingNormalizedNames: Set<string>
): DeduplicationResult<T> {
  const unique: T[] = [];
  const duplicates: DeduplicationResult<T>["duplicates"] = [];

  for (const item of candidates) {
    const key = `${item.normalizedName}::${item.subject.toLowerCase()}`;

    if (existingNormalizedNames.has(key)) {
      duplicates.push({
        item,
        reason: "already_exists_in_db",
        duplicateOf: item.normalizedName,
      });
    } else {
      unique.push(item);
    }
  }

  return { unique, duplicates };
}
