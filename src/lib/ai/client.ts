/**
 * AI client.
 * Singleton access point for the configured AI provider.
 * Includes retry logic with exponential backoff.
 */

import type { AIProvider, AICompletionRequest, AICompletionResponse } from "./types";
import { getAIConfig, AI_PROCESSING } from "./constants";
import { createProvider } from "./provider";
import { createAILogger } from "./utils/logger";

const log = createAILogger("ai-client");

let _provider: AIProvider | null = null;

/** Get the configured AI provider instance (lazy singleton). */
export function getAIProvider(): AIProvider {
  if (!_provider) {
    const config = getAIConfig();
    _provider = createProvider(config);
    log.info("AI provider initialized", {
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl,
    });
  }
  return _provider;
}

/** Reset provider — useful for testing or config changes. */
export function resetAIProvider(): void {
  _provider = null;
}

/**
 * Execute an AI completion with automatic retry and exponential backoff.
 * This is the primary entry point for all AI operations.
 * Returns the response with attempt metadata for observability.
 */
export async function executeWithRetry(
  request: AICompletionRequest,
  maxRetries: number = AI_PROCESSING.MAX_JOB_RETRIES
): Promise<AICompletionResponse & { attempts: number }> {
  const provider = getAIProvider();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay =
          AI_PROCESSING.RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);

        log.info(`Retry attempt ${attempt}/${maxRetries}`, {
          delay,
          provider: provider.name,
        });

        await sleep(delay);
      }

      const response = await provider.complete(request);
      return { ...response, attempts: attempt + 1 };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      log.warn(`AI completion attempt ${attempt + 1} failed`, {
        error: lastError.message,
        attempt: attempt + 1,
        maxRetries,
      });

      // Don't retry on certain errors
      if (isNonRetryableError(lastError)) {
        throw lastError;
      }
    }
  }

  throw new Error(
    `AI completion failed after ${maxRetries + 1} attempts: ${lastError?.message}`
  );
}

/** Check if the current AI provider is reachable. */
export async function checkAIHealth(): Promise<boolean> {
  try {
    const provider = getAIProvider();
    return await provider.isAvailable();
  } catch {
    return false;
  }
}

// ─── Internal helpers ───────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNonRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("unsupported") ||
    message.includes("invalid api key") ||
    message.includes("authentication") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("connect_timeout")
  );
}
