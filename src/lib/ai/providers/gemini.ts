/**
 * Google Gemini AI provider implementation.
 * Communicates with the Gemini REST API via HTTP.
 * Implements the AIProvider interface — same contract as OllamaProvider.
 *
 * Uses the generateContent endpoint with API key authentication.
 */

import type {
  AIProvider,
  AICompletionRequest,
  AICompletionResponse,
  AIProviderConfig,
} from "../types";
import { createAILogger } from "../utils/logger";

const log = createAILogger("gemini-provider");

// ─── Gemini API types ───────────────────────────────────────

interface GeminiContent {
  role: string;
  parts: { text: string }[];
}

interface GeminiGenerateRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: { text: string }[] };
  generationConfig: {
    temperature: number;
    maxOutputTokens: number;
    responseMimeType?: string;
  };
}

interface GeminiGenerateResponse {
  candidates: {
    content: {
      parts: { text: string }[];
      role: string;
    };
    finishReason: string;
  }[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
  modelVersion?: string;
}

// ─── Provider ───────────────────────────────────────────────

export class GeminiProvider implements AIProvider {
  readonly name = "gemini" as const;
  private readonly config: AIProviderConfig;
  private readonly apiKey: string;

  constructor(config: AIProviderConfig) {
    this.config = config;

    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error(
        "GEMINI_API_KEY environment variable is required for Gemini provider"
      );
    }
    this.apiKey = key;
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    const startTime = Date.now();

    // Build request body
    const geminiRequest: GeminiGenerateRequest = {
      contents: [
        {
          role: "user",
          parts: [{ text: request.prompt }],
        },
      ],
      generationConfig: {
        temperature: request.temperature ?? this.config.defaultTemperature,
        maxOutputTokens: request.maxTokens ?? this.config.defaultMaxTokens,
      },
    };

    // System instruction (Gemini supports this as a top-level field)
    if (request.systemPrompt) {
      geminiRequest.systemInstruction = {
        parts: [{ text: request.systemPrompt }],
      };
    }

    // JSON mode
    if (request.format === "json") {
      geminiRequest.generationConfig.responseMimeType = "application/json";
    }

    const url = `${this.config.baseUrl}/v1beta/models/${this.config.model}:generateContent?key=${this.apiKey}`;

    log.info("→ STEP: Sending request to Gemini", {
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiRequest),
        signal: controller.signal,
        cache: "no-store",
      });

      log.info("→ STEP: Gemini HTTP response received", {
        status: response.status,
        ok: response.ok,
        latencyMs: Date.now() - startTime,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "Unknown error");
        throw new Error(
          `Gemini API error (${response.status}): ${errorBody}`
        );
      }

      const rawText = await response.text();

      log.info("→ STEP: Response body read", {
        bodyLength: rawText.length,
        latencyMs: Date.now() - startTime,
      });

      let data: GeminiGenerateResponse;
      try {
        data = JSON.parse(rawText) as GeminiGenerateResponse;
      } catch (parseError) {
        log.error("Failed to parse Gemini response as JSON", {
          rawText: rawText.slice(0, 500),
          error:
            parseError instanceof Error
              ? parseError.message
              : String(parseError),
        });
        throw new Error(
          `Gemini returned non-JSON response: ${rawText.slice(0, 200)}`
        );
      }

      // Extract text from candidates
      const content = data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text)
        .join("") ?? "";

      if (!content) {
        const finishReason = data.candidates?.[0]?.finishReason ?? "unknown";
        log.warn("Gemini returned empty content", { finishReason });
        throw new Error(
          `Gemini returned empty response (finishReason: ${finishReason})`
        );
      }

      const latencyMs = Date.now() - startTime;

      log.info("→ STEP: Gemini response parsed successfully", {
        model: this.config.model,
        latencyMs,
        responseLength: content.length,
        finishReason: data.candidates[0].finishReason,
      });

      return {
        content,
        model: data.modelVersion ?? this.config.model,
        provider: "gemini",
        tokenUsage: data.usageMetadata
          ? {
              promptTokens: data.usageMetadata.promptTokenCount,
              completionTokens: data.usageMetadata.candidatesTokenCount,
              totalTokens: data.usageMetadata.totalTokenCount,
            }
          : undefined,
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;

      if (error instanceof Error && error.name === "AbortError") {
        log.error("Gemini request TIMED OUT", {
          timeoutMs: this.config.timeoutMs,
          latencyMs,
        });
        throw new Error(
          `Gemini request timed out after ${this.config.timeoutMs}ms`
        );
      }

      log.error("Gemini request failed", {
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

      // Use the models.get endpoint as a lightweight health check
      const url = `${this.config.baseUrl}/v1beta/models/${this.config.model}?key=${this.apiKey}`;
      const response = await fetch(url, {
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
