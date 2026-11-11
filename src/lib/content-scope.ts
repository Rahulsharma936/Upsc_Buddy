/**
 * Content scope — filter Practice and Revision by where a concept came from
 * (pure, browser-safe).
 *
 *   all      every concept
 *   static   concepts from the student's own study (daily log, notes)
 *   current  current affairs: concepts saved from the newspaper
 */

export const CONTENT_SCOPES = ["all", "static", "current"] as const;
export type ContentScope = (typeof CONTENT_SCOPES)[number];

export const CONTENT_SCOPE_LABEL: Record<ContentScope, string> = {
  all: "All",
  static: "Static syllabus",
  current: "Current affairs",
};

/** A query-string value as a scope; anything unknown means "all". */
export function parseScope(value: string | string[] | null | undefined): ContentScope {
  const v = Array.isArray(value) ? value[0] : value;
  return (CONTENT_SCOPES as readonly string[]).includes(v ?? "") ? (v as ContentScope) : "all";
}

export function isCurrentAffairs(extractionMetadata: unknown): boolean {
  return (extractionMetadata as Record<string, unknown> | null | undefined)?.source === "newspaper";
}

export function matchesScope(extractionMetadata: unknown, scope: ContentScope): boolean {
  if (scope === "all") return true;
  return isCurrentAffairs(extractionMetadata) === (scope === "current");
}

/** How many items fall in each scope. */
export function countByScope<T>(items: T[], metadataOf: (item: T) => unknown): Record<ContentScope, number> {
  const current = items.filter((i) => isCurrentAffairs(metadataOf(i))).length;
  return { all: items.length, static: items.length - current, current };
}

/** "?scope=current" for links; empty for "all". */
export function scopeQuery(scope: ContentScope): string {
  return scope === "all" ? "" : `?scope=${scope}`;
}
