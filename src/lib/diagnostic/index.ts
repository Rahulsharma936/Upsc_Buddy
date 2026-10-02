/**
 * Diagnostic module — R2.2+
 *
 * Feature extraction layer and diagnostic scoring engine.
 *
 * R2.2: Feature extraction
 *   import { extractFeatures } from "@/lib/diagnostic";
 *   import type { ConceptFeatures } from "@/lib/diagnostic";
 *
 * R2.3: Diagnostic engine
 *   import { diagnose } from "@/lib/diagnostic";
 *   import type { ConceptDiagnosticReport } from "@/lib/diagnostic";
 */

// R2.2: Feature extraction
export { extractFeatures } from "./feature.extractor";

export type {
  ConceptFeatures,
  FeatureExtractionConfig,
} from "./feature.types";

export { DEFAULT_FEATURE_CONFIG } from "./feature.types";

// R2.3: Diagnostic engine
export { diagnose, DEFAULT_SCORING_CONFIG } from "./diagnostic.engine";

export type {
  DiagnosisType,
  ConceptDiagnosis,
  ConceptDiagnosticReport,
  FeatureContribution,
  ScoringConfig,
  ScoringWeights,
  ScoringThresholds,
} from "./diagnostic.types";

export { ALL_DIAGNOSIS_TYPES } from "./diagnostic.types";

// R2.7: Repair contract (R3 handoff)
export type {
  RepairRequest,
  RepairSession,
  RepairActivity,
  RepairOutcome,
  RepairStrategy,
} from "./repair.types";
