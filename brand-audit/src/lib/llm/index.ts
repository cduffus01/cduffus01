import { config } from "@/lib/config";

/**
 * Multimodal LLM abstraction (spec section 22: do not couple business logic to
 * one provider).
 *
 * Hard rule for V0: every caller must work when `isAvailable()` is false. No
 * score component may depend on a model response.
 */
export interface LlmMessageImage {
  base64: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
}

export interface LlmRequest {
  system: string;
  prompt: string;
  images?: LlmMessageImage[];
  maxTokens?: number;
}

export interface LlmProvider {
  readonly name: string;
  isAvailable(): boolean;
  complete(req: LlmRequest): Promise<string | null>;
  /** Convenience: parse a JSON object out of the model response, or null. */
  completeJson<T>(req: LlmRequest): Promise<T | null>;
}

abstract class BaseProvider implements LlmProvider {
  abstract readonly name: string;
  abstract isAvailable(): boolean;
  abstract complete(req: LlmRequest): Promise<string | null>;

  async completeJson<T>(req: LlmRequest): Promise<T | null> {
    const raw = await this.complete(req);
    if (!raw) return null;
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
}

class NoopProvider extends BaseProvider {
  readonly name = "none";
  isAvailable() { return false; }
  async complete() { return null; }
}

class AnthropicProvider extends BaseProvider {
  readonly name = "anthropic";

  isAvailable() { return Boolean(config.llm.apiKey); }

  async complete(req: LlmRequest): Promise<string | null> {
    if (!this.isAvailable()) return null;
    const content: unknown[] = [];
    for (const image of req.images ?? []) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: image.mediaType, data: image.base64 },
      });
    }
    content.push({ type: "text", text: req.prompt });

    try {
      const res = await fetch(`${config.llm.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": config.llm.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: config.llm.model,
          max_tokens: req.maxTokens ?? 1024,
          system: req.system,
          messages: [{ role: "user", content }],
        }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { content?: { type: string; text?: string }[] };
      return json.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("") || null;
    } catch {
      // The audit must survive an LLM outage; callers fall back to deterministic output.
      return null;
    }
  }
}

let provider: LlmProvider | null = null;

export function getLlm(): LlmProvider {
  if (!provider) {
    provider = config.llm.apiKey ? new AnthropicProvider() : new NoopProvider();
  }
  return provider;
}
