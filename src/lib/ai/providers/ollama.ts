/**
 * Ollama AI provider implementation.
 * Communicates with a local Ollama instance via HTTP.
 * Implements the AIProvider interface for clean abstraction.
 *
 * IMPORTANT: Uses cache: "no-store" to prevent Next.js fetch caching.
 */

import type {
  AIProvider,
  AICompletionRequest,
  AICompletionResponse,
  AIProviderConfig,
} from "../types";
import { createAILogger } from "../utils/logger";

const log = createAILogger("ollama-provider");

/** Ollama API request body shape. */
interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  system?: string;
  stream: false;
  format?: "json";
  options: {
    temperature: number;
    num_predict: number;
  };
}

/** Ollama API response body shape. */
interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider implements AIProvider {
  readonly name = "ollama" as const;
  private readonly config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = config;
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    const startTime = Date.now();

    const ollamaRequest: OllamaGenerateRequest = {
      model: this.config.model,
      prompt: request.prompt,
      system: request.systemPrompt,
      stream: false,
      format: request.format,
      options: {
        temperature: request.temperature ?? this.config.defaultTemperature,
        num_predict: request.maxTokens ?? this.config.defaultMaxTokens,
      },
    };

    log.info("→ STEP: Sending request to Ollama", {
      model: this.config.model,
      baseUrl: this.config.baseUrl,
      promptLength: request.prompt.length,
      timeoutMs: this.config.timeoutMs,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs
    );

    try {
      const response = await fetch(
        `${this.config.baseUrl}/api/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ollamaRequest),
          signal: controller.signal,
          // CRITICAL: Prevent Next.js from caching/buffering this fetch
          cache: "no-store",
        }
      );

      log.info("→ STEP: Ollama HTTP response received", {
        status: response.status,
        ok: response.ok,
        latencyMs: Date.now() - startTime,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "Unknown error");
        throw new Error(
          `Ollama API error (${response.status}): ${errorBody}`
        );
      }

      const rawText = await response.text();

      log.info("→ STEP: Response body read", {
        bodyLength: rawText.length,
        latencyMs: Date.now() - startTime,
      });

      let data: OllamaGenerateResponse;
      try {
        data = JSON.parse(rawText) as OllamaGenerateResponse;
      } catch (parseError) {
        log.error("Failed to parse Ollama response as JSON", {
          rawText: rawText.slice(0, 500),
          error: parseError instanceof Error ? parseError.message : String(parseError),
        });
        throw new Error(
          `Ollama returned non-JSON response: ${rawText.slice(0, 200)}`
        );
      }

      const latencyMs = Date.now() - startTime;

      log.info("→ STEP: Ollama response parsed successfully", {
        model: data.model,
        latencyMs,
        responseLength: data.response?.length ?? 0,
        done: data.done,
      });

      return {
        content: data.response,
        model: data.model,
        provider: "ollama",
        tokenUsage: data.prompt_eval_count != null && data.eval_count != null
          ? {
              promptTokens: data.prompt_eval_count,
              completionTokens: data.eval_count,
              totalTokens: data.prompt_eval_count + data.eval_count,
            }
          : undefined,
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;

      if (error instanceof Error && error.name === "AbortError") {
        log.error("Ollama request TIMED OUT", {
          timeoutMs: this.config.timeoutMs,
          latencyMs,
        });
        throw new Error(
          `Ollama request timed out after ${this.config.timeoutMs}ms`
        );
      }

      log.error("Ollama request failed", {
        error: error instanceof Error ? error.message : String(error),
        latencyMs,
        model: this.config.model,
      });

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        signal: controller.signal,
        cache: "no-store",
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }
}
