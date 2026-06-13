/**
 * Relationship normalization utilities.
 * Cleans AI-generated relationship data for consistent formatting.
 *
 * Phase 2D: Handles reason cleanup, strength calibration,
 * cross-subject detection, and dedup key generation.
 */

import type { RelationshipType, RELATIONSHIP_TYPES } from "../types";

// ─── Allowed relationship types set (for fast lookup) ───────
const VALID_TYPES = new Set<string>([
  "constitutional_link",
  "governance_link",
  "economic_impact",
  "policy_interaction",
  "ethical_dimension",
  "historical_context",
  "geographic_relevance",
  "current_affairs_connection",
  "institutional_relationship",
  "cause_effect",
  "comparative_relation",
]);

// ─── Reason Normalizer ──────────────────────────────────────

/** Clean a relationship reason for consistent formatting. */
export function normalizeReason(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^[-•*▪▸→]+\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    // Capitalize first letter
    .replace(/^./, (c) => c.toUpperCase())
    // Ensure ends with period
    .replace(/([a-zA-Z0-9])$/, "$1.");
}

// ─── Type Validator ─────────────────────────────────────────

/** Validate and normalize a relationship type. Returns null if invalid. */
export function normalizeRelationshipType(raw: string): RelationshipType | null {
  const cleaned = raw.trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  if (VALID_TYPES.has(cleaned)) {
    return cleaned as RelationshipType;
  }
  return null;
}

// ─── Cross-Subject Detection ────────────────────────────────

/** Determine if two concepts are from different UPSC subjects. */
export function isCrossSubject(sourceSubject: string, targetSubject: string): boolean {
  return sourceSubject.toLowerCase().trim() !== targetSubject.toLowerCase().trim();
}

// ─── Strength Calibration ───────────────────────────────────

/**
 * UPSC analytical value weight per relationship type.
 * Higher = more exam-relevant = bigger score boost.
 */
const TYPE_WEIGHTS: Record<string, number> = {
  constitutional_link: 0.12,
  governance_link: 0.10,
  policy_interaction: 0.08,
  cause_effect: 0.07,
  economic_impact: 0.06,
  institutional_relationship: 0.05,
  ethical_dimension: 0.04,
  current_affairs_connection: 0.03,
  historical_context: 0.02,
  geographic_relevance: 0.01,
  comparative_relation: 0.0,
};

/**
 * Signals of analytical depth in a reason string.
 * Presence of these indicates UPSC-style specificity.
 */
const DEPTH_SIGNALS = [
  /article\s+\d/i,
  /schedule/i,
  /amendment/i,
  /act[\s,]/i,
  /commission/i,
  /committee/i,
  /part\s+(iv|iii|ii|i|v|vi)/i,
  /directive\s+principles/i,
  /fundamental/i,
  /panchayat/i,
  /concurrent\s+list/i,
  /state\s+list/i,
  /union\s+list/i,
  /gs\s*-?\s*[1234]/i,
];

/**
 * Signals of vague/generic reasoning.
 */
const VAGUE_SIGNALS = [
  /both involve/i,
  /related to/i,
  /connected with/i,
  /associated with/i,
  /deals with/i,
  /pertains to/i,
  /similar to/i,
];

/**
 * Calibrate relationship strength with multi-signal scoring.
 *
 * The AI (qwen2.5:7b) outputs scores tightly clustered at 0.85–0.95.
 * This function rescales that narrow band into a meaningful 0.45–0.95 range
 * using deterministic quality signals from the relationship data.
 */
export function calibrateStrength(params: {
  rawStrength: number;
  crossSubject: boolean;
  reasonLength: number;
  relationshipType: RelationshipType;
  reason?: string;
}): number {
  // ─── Step 1: Rescale AI's narrow band ──────────────────
  // Map [0.4, 1.0] → [0.35, 0.65] as a neutral baseline
  // This "deflates" the uniformly-high AI scores into a middle range
  // so that quality signals can push scores up or down meaningfully.
  const baseScore = 0.35 + (params.rawStrength - 0.4) * (0.30 / 0.6);

  // ─── Step 2: Type-based weight ─────────────────────────
  const typeBoost = TYPE_WEIGHTS[params.relationshipType] ?? 0;

  // ─── Step 3: Reason quality analysis ───────────────────
  let reasonBonus = 0;
  const reason = params.reason ?? "";

  // Length-based (analytical depth correlates with length)
  if (params.reasonLength > 120) {
    reasonBonus += 0.06;
  } else if (params.reasonLength > 80) {
    reasonBonus += 0.03;
  } else if (params.reasonLength < 30) {
    reasonBonus -= 0.08; // Very short = likely generic
  }

  // Depth signal detection
  let depthHits = 0;
  for (const signal of DEPTH_SIGNALS) {
    if (signal.test(reason)) depthHits++;
  }
  reasonBonus += Math.min(depthHits * 0.03, 0.09); // Cap at 3 hits

  // Vagueness penalty
  for (const signal of VAGUE_SIGNALS) {
    if (signal.test(reason)) {
      reasonBonus -= 0.06;
      break; // One penalty is enough
    }
  }

  // ─── Step 4: Cross-subject boost ───────────────────────
  const crossBoost = params.crossSubject ? 0.05 : 0;

  // ─── Step 5: Combine and clamp ─────────────────────────
  const raw = baseScore + typeBoost + reasonBonus + crossBoost;

  // Clamp to [0.30, 0.97]
  const clamped = Math.max(0.30, Math.min(0.97, raw));

  // Round to 2 decimal places
  return Math.round(clamped * 100) / 100;
}

/**
 * Spread clustered scores for a batch of relationships.
 * If multiple relationships have near-identical scores (within ±0.02),
 * spread them to create visible differentiation while preserving rank order.
 *
 * Call this AFTER individual calibration, BEFORE persistence.
 */
export function spreadClusteredScores(
  items: Array<{ strength: number; [key: string]: unknown }>
): void {
  if (items.length < 2) return;

  // Sort by strength descending (preserve rank)
  items.sort((a, b) => b.strength - a.strength);

  // Minimum gap between adjacent scores
  const MIN_GAP = 0.03;

  for (let i = 1; i < items.length; i++) {
    const diff = items[i - 1].strength - items[i].strength;
    if (diff < MIN_GAP) {
      // Push this score down to create the minimum gap
      items[i].strength = Math.max(
        MIN_RELATIONSHIP_STRENGTH,
        Math.round((items[i - 1].strength - MIN_GAP) * 100) / 100
      );
    }
  }
}

// ─── Dedup Key ──────────────────────────────────────────────

/**
 * Generate a canonical dedup key for a relationship edge.
 * Sorted so A→B and B→A produce the same key for the same type.
 */
export function generateDedupKey(
  sourceId: string,
  targetId: string,
  type: string
): string {
  const sorted = [sourceId, targetId].sort();
  return `${sorted[0]}::${sorted[1]}::${type}`;
}

// ─── Minimum Strength Threshold ─────────────────────────────

/** Minimum strength to persist a relationship. Intentionally strict — sparse but trustworthy. */
export const MIN_RELATIONSHIP_STRENGTH = 0.50;
