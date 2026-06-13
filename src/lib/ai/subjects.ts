/**
 * UPSC subject constants.
 * Single source of truth for valid UPSC subjects.
 * Used in Zod schemas, prompt engineering, and subject validation.
 */

export const UPSC_SUBJECTS = [
  "Polity",
  "Geography",
  "History",
  "Economy",
  "Ethics",
  "CurrentAffairs",
] as const;

export type UPSCSubject = (typeof UPSC_SUBJECTS)[number];

/** Set for O(1) lookup during validation. */
const VALID_SUBJECTS_SET = new Set<string>(UPSC_SUBJECTS);

/** Mapping of common AI outputs / aliases to canonical subjects. */
const SUBJECT_ALIASES: Record<string, UPSCSubject> = {
  // Polity aliases
  "polity": "Polity",
  "indian polity": "Polity",
  "governance": "Polity",
  "constitution": "Polity",
  "constitutional law": "Polity",
  "public administration": "Polity",
  "political science": "Polity",
  "indian constitution": "Polity",
  "federalism": "Polity",
  "judiciary": "Polity",
  "parliament": "Polity",
  "local governance": "Polity",
  "panchayati raj": "Polity",

  // Added aliases
  "polity & governance": "Polity",
  "polity and governance": "Polity",
  "public policy": "Polity",

  // Geography aliases
  "geography": "Geography",
  "indian geography": "Geography",
  "world geography": "Geography",
  "physical geography": "Geography",
  "human geography": "Geography",
  "environment": "Geography",
  "ecology": "Geography",
  "environment and ecology": "Geography",
  "environment & ecology": "Geography",
  "environmental science": "Geography",
  "climatology": "Geography",
  "oceanography": "Geography",
  "geomorphology": "Geography",
  "disaster management": "Geography",
  "agriculture": "Geography",
  "natural resources": "Geography",
  "mineral resources": "Geography",
  "climate change": "Geography",
  "biodiversity": "Geography",

  // History aliases
  "history": "History",
  "history & culture": "History",
  "history and culture": "History",
  "indian history": "History",
  "modern history": "History",
  "ancient history": "History",
  "medieval history": "History",
  "world history": "History",
  "art and culture": "History",
  "culture": "History",
  "indian heritage": "History",
  "indian heritage and culture": "History",
  "indian heritage & culture": "History",
  "freedom struggle": "History",

  // Economy aliases
  "economy": "Economy",
  "economics": "Economy",
  "indian economy": "Economy",
  "economic development": "Economy",
  "finance": "Economy",
  "banking": "Economy",
  "monetary policy": "Economy",
  "fiscal policy": "Economy",
  "public finance": "Economy",
  "taxation": "Economy",
  "trade": "Economy",
  "infrastructure": "Economy",
  "industry": "Economy",

  // Ethics aliases
  "ethics": "Ethics",
  "ethics and integrity": "Ethics",
  "integrity": "Ethics",
  "aptitude": "Ethics",
  "ethics integrity and aptitude": "Ethics",
  "ethics, integrity and aptitude": "Ethics",
  "probity": "Ethics",
  "moral philosophy": "Ethics",

  // Current affairs aliases
  "currentaffairs": "CurrentAffairs",
  "current affairs": "CurrentAffairs",
  "current events": "CurrentAffairs",
  "international relations": "CurrentAffairs",
  "ir": "CurrentAffairs",
  "science and technology": "CurrentAffairs",
  "science & technology": "CurrentAffairs",
  "science": "CurrentAffairs",
  "technology": "CurrentAffairs",
  "security": "CurrentAffairs",
  "internal security": "CurrentAffairs",
  "social justice": "CurrentAffairs",
  "social issues": "CurrentAffairs",
  "indian society": "CurrentAffairs",
  "society": "CurrentAffairs",
};

/**
 * Resolve a raw subject string to a canonical UPSC subject.
 * Returns the canonical subject or null if unresolvable.
 */
export function resolveSubject(raw: string): UPSCSubject | null {
  const trimmed = raw.trim();

  // Direct match (case-sensitive)
  if (VALID_SUBJECTS_SET.has(trimmed)) {
    return trimmed as UPSCSubject;
  }

  // Alias lookup (case-insensitive)
  const normalized = trimmed.toLowerCase();
  const alias = SUBJECT_ALIASES[normalized];
  if (alias) {
    return alias;
  }

  return null;
}
