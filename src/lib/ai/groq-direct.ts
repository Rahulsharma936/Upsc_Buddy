/**
 * Direct Groq calls with a model fallback chain.
 *
 * Used where a feature needs a specific model (or a vision model) rather than
 * the single configured provider model. On a short rate limit (≤ 30 s) it
 * waits as instructed; on a long one (a daily cap) it moves to the next model.
 */

const BASE = () => process.env.GROQ_BASE_URL || "https://api.groq.com";

export class GroqDirectError extends Error {
  constructor(message: string, public readonly status: number = 502) {
    super(message);
  }
}

function retryAfterSeconds(body: string): number {
  const m = body.match(/try again in\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*([\d.]+)\s*s/i);
  if (!m) return 15;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3]);
}

export async function groqChat(params: {
  models: string[];
  system: string;
  user: string | Array<Record<string, unknown>>;
  maxTokens: number;
  json?: boolean;
  temperature?: number;
}): Promise<{ content: string; model: string }> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new GroqDirectError("GROQ_API_KEY is not configured", 503);

  let lastError = "no model available";
  for (const model of params.models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${BASE()}/openai/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: params.temperature ?? 0.2,
          max_completion_tokens: params.maxTokens,
          ...(params.json ? { response_format: { type: "json_object" } } : {}),
          // gpt-oss reasons before answering; low effort cuts hidden output tokens.
          ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
          messages: [
            { role: "system", content: params.system },
            { role: "user", content: params.user },
          ],
        }),
      }).catch((err) => {
        lastError = err instanceof Error ? err.message : String(err);
        return null;
      });
      if (!res) break;

      if (res.status === 429) {
        const body = await res.text();
        const wait = retryAfterSeconds(body);
        lastError = `${model}: rate limited (${Math.round(wait)}s)`;
        if (wait > 30) break; // daily cap or long wait → next model
        await new Promise((r) => setTimeout(r, Math.ceil(wait * 1000) + 750));
        continue;
      }
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        lastError = `${model}: ${json?.error?.message ?? `HTTP ${res.status}`}`;
        break; // try next model
      }
      const content = String(json?.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      if (!content) {
        lastError = `${model}: empty response`;
        break;
      }
      return { content, model };
    }
  }
  throw new GroqDirectError(`AI unavailable — ${lastError}`);
}

/** Read text from images with the vision model. */
export async function groqVisionText(images: string[], instruction: string, maxTokens = 4_000): Promise<{ text: string; model: string }> {
  const model = process.env.GROQ_VISION_MODEL || "qwen/qwen3.8-27b";
  const { content } = await groqChat({
    models: [model],
    system: "You transcribe documents accurately.",
    user: [{ type: "text", text: instruction }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))],
    maxTokens,
    temperature: 0,
  });
  return { text: content, model };
}
