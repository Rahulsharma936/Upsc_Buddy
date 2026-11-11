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

  let rateLimitWaitMs = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        // On a 429, wait as long as the provider asked (capped); otherwise back off.
        const delay = rateLimitWaitMs > 0
          ? rateLimitWaitMs
          : AI_PROCESSING.RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        rateLimitWaitMs = 0;

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

      // A daily cap ("try again in 19m25s") cannot be waited out: fail now.
      if (isLongRateLimit(lastError.message)) throw lastError;

      rateLimitWaitMs = rateLimitDelayMs(lastError.message);
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

/**
 * For a 429 rate-limit error, the wait the provider asked for ("Please try
 * again in 9.48s") plus a small margin, capped at 30 s. 0 if not a rate limit.
 */
export function rateLimitDelayMs(message: string): number {
  if (!/\b429\b|rate limit/i.test(message)) return 0;
  const m = message.match(/try again in\s+(?:(\d+)m)?\s*([\d.]+)\s*s/i);
  const seconds = m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : 15;
  return Math.min(30_000, Math.ceil(seconds * 1000) + 750);
}

/** True for a rate limit whose suggested wait exceeds a minute (e.g. a daily token cap). */
export function isLongRateLimit(message: string): boolean {
  if (!/\b429\b|rate limit/i.test(message)) return false;
  if (/tokens per day|requests per day|\bTPD\b|\bRPD\b/i.test(message)) return true;
  const m = message.match(/try again in\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*([\d.]+)\s*s/i);
  if (!m) return false;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3]) > 60;
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
