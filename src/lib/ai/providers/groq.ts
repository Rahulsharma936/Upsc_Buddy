/**
 * Groq AI provider implementation.
 * Communicates with the Groq API via their OpenAI-compatible endpoint.
 * Implements the AIProvider interface — same contract as OllamaProvider / GeminiProvider.
 *
 * Uses the /openai/v1/chat/completions endpoint with Bearer token auth.
 */

import type {
  AIProvider,
  AICompletionRequest,
  AICompletionResponse,
  AIProviderConfig,
} from "../types";
import { createAILogger } from "../utils/logger";

const log = createAILogger("groq-provider");

// ─── Groq (OpenAI-compatible) API types ─────────────────────

interface GroqMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface GroqChatRequest {
  model: string;
  messages: GroqMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
}

interface GroqChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ─── Provider ───────────────────────────────────────────────

export class GroqProvider implements AIProvider {
  readonly name = "groq" as const;
  private readonly config: AIProviderConfig;
  private readonly apiKey: string;

  constructor(config: AIProviderConfig) {
    this.config = config;

    const key = process.env.GROQ_API_KEY;
    if (!key) {
      throw new Error(
        "GROQ_API_KEY environment variable is required for Groq provider"
      );
    }
    this.apiKey = key;
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    const startTime = Date.now();

    // Build messages array
    const messages: GroqMessage[] = [];

    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }

    messages.push({ role: "user", content: request.prompt });

    // Build request body
    const groqRequest: GroqChatRequest = {
      model: this.config.model,
      messages,
      temperature: request.temperature ?? this.config.defaultTemperature,
      max_tokens: request.maxTokens ?? this.config.defaultMaxTokens,
    };

    // JSON mode
    if (request.format === "json") {
      groqRequest.response_format = { type: "json_object" };
    }

    const url = `${this.config.baseUrl}/openai/v1/chat/completions`;

    log.info("→ STEP: Sending request to Groq", {
      model: this.config.model,
      promptLength: request.prompt.length,
      timeoutMs: this.config.timeoutMs,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs
    );

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(groqRequest),
        signal: controller.signal,
        cache: "no-store",
      });

      log.info("→ STEP: Groq HTTP response received", {
        status: response.status,
        ok: response.ok,
        latencyMs: Date.now() - startTime,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "Unknown error");
        throw new Error(
          `Groq API error (${response.status}): ${errorBody}`
        );
      }

      const rawText = await response.text();

      log.info("→ STEP: Response body read", {
        bodyLength: rawText.length,
        latencyMs: Date.now() - startTime,
      });

      let data: GroqChatResponse;
      try {
        data = JSON.parse(rawText) as GroqChatResponse;
      } catch (parseError) {
        log.error("Failed to parse Groq response as JSON", {
          rawText: rawText.slice(0, 500),
          error:
            parseError instanceof Error
              ? parseError.message
              : String(parseError),
        });
        throw new Error(
          `Groq returned non-JSON response: ${rawText.slice(0, 200)}`
        );
      }

      // Extract content from choices
      const content = data.choices?.[0]?.message?.content ?? "";

      if (!content) {
        const finishReason = data.choices?.[0]?.finish_reason ?? "unknown";
        log.warn("Groq returned empty content", { finishReason });
        throw new Error(
          `Groq returned empty response (finish_reason: ${finishReason})`
        );
      }

      const latencyMs = Date.now() - startTime;

      log.info("→ STEP: Groq response parsed successfully", {
        model: data.model,
        latencyMs,
        responseLength: content.length,
        finishReason: data.choices[0].finish_reason,
      });

      return {
        content,
        model: data.model ?? this.config.model,
        provider: "groq",
        tokenUsage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
            }
          : undefined,
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;

      if (error instanceof Error && error.name === "AbortError") {
        log.error("Groq request TIMED OUT", {
          timeoutMs: this.config.timeoutMs,
          latencyMs,
        });
        throw new Error(
          `Groq request timed out after ${this.config.timeoutMs}ms`
        );
      }

      log.error("Groq request failed", {
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

      // Use the models endpoint as a lightweight health check
      const url = `${this.config.baseUrl}/openai/v1/models`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
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
