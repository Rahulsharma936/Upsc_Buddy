/**
 * AI infrastructure constants.
 * Centralized configuration — never hardcode model names or URLs elsewhere.
 * All values are loaded from environment variables with safe fallbacks.
 */

import type { AIProviderConfig, AIProviderName } from "./types";

// ─── Environment-driven configuration ───────────────────────
function getProviderConfig(): AIProviderConfig {
  const provider = (process.env.AI_PROVIDER ?? "ollama") as AIProviderName;

  switch (provider) {
    case "ollama":
      return {
        provider: "ollama",
        baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
        model: process.env.OLLAMA_MODEL ?? "qwen2.5:7b",
        defaultTemperature: 0.1, // Low temperature for deterministic extraction
        defaultMaxTokens: 4096,
        timeoutMs: 300_000, // 5 minutes for CPU-based local models
        maxRetries: 1, // Only 1 retry — prevents timeout amplification on CPU
      };

    case "openai":
      return {
        provider: "openai",
        baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        defaultTemperature: 0.1,
        defaultMaxTokens: 4096,
        timeoutMs: 60_000,
        maxRetries: 3,
      };

    case "anthropic":
      return {
        provider: "anthropic",
        baseUrl: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
        model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514",
        defaultTemperature: 0.1,
        defaultMaxTokens: 4096,
        timeoutMs: 60_000,
        maxRetries: 3,
      };

    case "gemini":
      return {
        provider: "gemini",
        baseUrl: process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com",
        model: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
        defaultTemperature: 0.1,
        defaultMaxTokens: 4096,
        timeoutMs: 60_000,
        maxRetries: 3,
      };

    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
}

/** Lazily cached provider configuration. */
let _config: AIProviderConfig | null = null;

export function getAIConfig(): AIProviderConfig {
  if (!_config) {
    _config = getProviderConfig();
  }
  return _config;
}

/** Reset config cache — useful for testing. */
export function resetAIConfig(): void {
  _config = null;
}

// ─── Processing constants ───────────────────────────────────
export const AI_PROCESSING = {
  /** Maximum number of concepts to extract from a single log entry. */
  MAX_CONCEPTS_PER_LOG: 20,

  /** Minimum confidence threshold to persist an extracted concept. */
  MIN_CONFIDENCE_THRESHOLD: 0.3,

  /** Maximum retries before marking a job as permanently failed. */
  MAX_JOB_RETRIES: 3,

  /** Delay between retries in milliseconds (exponential backoff base). */
  RETRY_BASE_DELAY_MS: 1000,
} as const;
