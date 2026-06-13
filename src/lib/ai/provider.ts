/**
 * AI provider factory.
 * Creates the appropriate provider instance based on configuration.
 * This is the ONLY place that knows about concrete provider implementations.
 */

import type { AIProvider, AIProviderConfig } from "./types";
import { OllamaProvider } from "./providers/ollama";
import { createAILogger } from "./utils/logger";

const log = createAILogger("provider-factory");

/**
 * Create a provider instance from configuration.
 * New providers are added here — business logic never changes.
 */
export function createProvider(config: AIProviderConfig): AIProvider {
  switch (config.provider) {
    case "ollama":
      return new OllamaProvider(config);

    // ── Future providers ──────────────────────────────────
    // case "openai":
    //   return new OpenAIProvider(config);
    // case "anthropic":
    //   return new AnthropicProvider(config);
    // case "gemini":
    //   return new GeminiProvider(config);

    default:
      log.error(`Unsupported AI provider: ${config.provider}`);
      throw new Error(`Unsupported AI provider: ${config.provider}`);
  }
}
