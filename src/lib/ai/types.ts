/**
 * AI infrastructure types.
 * Defines the core interfaces for provider abstraction,
 * processing state, and structured AI outputs.
 *
 * Phase 2C: Cognitive-compression note generation model.
 * Sections: coreIdea, examTriggers, staticCurrentLink,
 * answerWritingAngles, memoryHooks.
 */

// ─── Processing Status ──────────────────────────────────────
export const AI_JOB_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
  "retrying",
] as const;

export type AIJobStatus = (typeof AI_JOB_STATUSES)[number];

// ─── Job Types ──────────────────────────────────────────────
export const AI_JOB_TYPES = [
  "concept_extraction",
  "note_generation",
  "relationship_extraction",
] as const;

export type AIJobType = (typeof AI_JOB_TYPES)[number];

// ─── Provider Names ─────────────────────────────────────────
export const AI_PROVIDERS = [
  "ollama",
  "openai",
  "anthropic",
  "gemini",
  "groq",
] as const;

export type AIProviderName = (typeof AI_PROVIDERS)[number];

// ─── Extracted Concept (post-normalization) ─────────────────
export interface ExtractedConcept {
  normalizedName: string;
  displayName: string;
  originalName: string;
  subject: string;
  keywords: string[];
  difficulty: "beginner" | "intermediate" | "advanced";
  confidence: number;
  confidenceSignals: {
    keywordRichness: number;
    extractionCompleteness: number;
    subjectCertainty: number;
    conceptSpecificity: number;
    parsingReliability: number;
  };
}

// ─── Generated Note (Phase 2C cognitive-compression model) ──
export interface GeneratedNote {
  coreIdea: string;
  examTriggers: string[];
  staticCurrentLink: string[];
  answerWritingAngles: string[];
  memoryHooks: string[];
}

// ─── Note Generation Input ──────────────────────────────────
export interface NoteGenerationInput {
  conceptId: string;
  userId: string;
  conceptName: string;
  subject: string;
  keywords: string[];
  difficulty: string;
  force?: boolean; // Force regeneration even if note exists
}

// ─── Note Generation Result ─────────────────────────────────
export interface NoteGenerationResult {
  jobId: string;
  noteId: string | null;
  version: number;
  note: GeneratedNote | null;
  warnings: string[];
  stats: NoteGenerationStats;
  processingTimeMs: number;
}

// ─── Note Generation Stats ──────────────────────────────────
export interface NoteGenerationStats {
  sectionsGenerated: number;
  sectionsRepaired: number;
  contentLength: number;
  examTriggerCount: number;
  memoryHookCount: number;
}

// ─── Note Generation Metadata (persisted per-note) ──────────
export interface NoteGenerationMetadata {
  generationVersion: string;
  provider: string;
  model: string;
  promptVersion: string;
  generationTimeMs: number;
  retryCount: number;
  parserStrategyUsed: string | null;
  validationWarnings: string[];
  sourceConceptVersion: string;
  contentHash: string;
  sectionsRepaired: string[];
}

// ─── Relationship Types (Phase 2D) ──────────────────────────

export const RELATIONSHIP_TYPES = [
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
] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

/** Raw AI output for a single relationship. */
export interface ExtractedRelationship {
  targetConceptName: string;
  relationshipType: RelationshipType;
  reason: string;
  strength: number;
}

/** Input to the relationship extraction pipeline. */
export interface RelationshipExtractionInput {
  conceptId: string;
  userId: string;
  conceptName: string;
  subject: string;
  keywords: string[];
  existingConceptNames: string[];
  force?: boolean;
}

/** Result of a relationship extraction run. */
export interface RelationshipExtractionResult {
  jobId: string;
  sourceConceptId: string;
  relationships: ExtractedRelationship[];
  warnings: string[];
  stats: RelationshipExtractionStats;
  processingTimeMs: number;
}

export interface RelationshipExtractionStats {
  totalExtracted: number;
  persisted: number;
  skippedSelfLoop: number;
  skippedDuplicate: number;
  skippedWeakStrength: number;
  skippedUnknownTarget: number;
  crossSubjectCount: number;
}

export interface RelationshipExtractionMetadata {
  extractionVersion: string;
  provider: string;
  model: string;
  generationTimeMs: number;
  parserStrategyUsed: string | null;
  validationWarnings: string[];
  sourceConceptName: string;
  sourceSubject: string;
}

// ─── Provider Request/Response ──────────────────────────────
export interface AICompletionRequest {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  format?: "json";
}

export interface AICompletionResponse {
  content: string;
  model: string;
  provider: AIProviderName;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
}

// ─── Provider Interface ─────────────────────────────────────
export interface AIProvider {
  readonly name: AIProviderName;
  complete(request: AICompletionRequest): Promise<AICompletionResponse>;
  isAvailable(): Promise<boolean>;
}

// ─── Provider Configuration ─────────────────────────────────
export interface AIProviderConfig {
  provider: AIProviderName;
  baseUrl: string;
  model: string;
  defaultTemperature: number;
  defaultMaxTokens: number;
  timeoutMs: number;
  maxRetries: number;
}

// ─── Processing Job Metadata ────────────────────────────────
export interface ProcessingJobMetadata {
  inputLength?: number;
  outputLength?: number;
  tokenUsage?: AICompletionResponse["tokenUsage"];
  latencyMs?: number;
  model?: string;
  provider?: string;
  retryReason?: string;
  attempts?: number;
  extractionVersion?: string;
  generationVersion?: string;
  parserStrategyUsed?: string | null;
  validationWarnings?: string[];
  conceptsExtracted?: number;
  conceptsSkipped?: number;
  conceptsDeduplicated?: number;
  noteVersion?: number;
  noteId?: string;
  [key: string]: unknown;
}

// ─── Extraction Metadata (per-concept) ──────────────────────
export interface ConceptExtractionMetadata {
  extractionVersion: string;
  provider: string;
  model: string;
  confidenceSignals: ExtractedConcept["confidenceSignals"];
  parserStrategyUsed: string | null;
  originalSubject: string;
  subjectResolved: boolean;
}

// ─── Service-level types ────────────────────────────────────
export interface ConceptExtractionInput {
  dailyLogId: string;
  userId: string;
  rawInput: string;
  subjects: string[];
}

export interface ConceptExtractionResult {
  jobId: string;
  concepts: ExtractedConcept[];
  warnings: string[];
  stats: {
    totalExtracted: number;
    persisted: number;
    skippedInvalidSubject: number;
    skippedLowConfidence: number;
    deduplicated: number;
  };
  processingTimeMs: number;
}
