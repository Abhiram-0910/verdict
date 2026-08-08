/**
 * providers/anthropic.ts
 * Anthropic provider adapter.
 *
 * Auth: x-api-key header + anthropic-version header (required by the API).
 * Models: GET https://api.anthropic.com/v1/models
 * Vision: capabilities.image_input.supported (native boolean — no proxy needed).
 *
 * Note: Anthropic's /v1/models response uses a different envelope than
 * OpenAI's — { data: ModelObject[], has_more, first_id, last_id }.
 * The ModelObject shape includes a `capabilities` field.
 *
 * STATUS: Code-complete. Live-verification pending API key.
 * See TODO.md: "Anthropic + xAI adapters: code-complete, live-verification pending API keys"
 */

import type { AIProvider, CritiqueRequest, CritiqueResult, ModelInfo, ProviderErrorReason } from './types.js';
import { ProviderFetchError } from './openaiCompatible.js';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const ANTHROPIC_VERSION = '2023-06-01';

interface CacheEntry {
  models: ModelInfo[];
  fetchedAt: number;
}

// Per-provider singleton cache (same pattern as openaiCompatible.ts)
const modelCache = new Map<string, CacheEntry>();

function classifyHttpError(status: number): ProviderErrorReason {
  if (status === 401 || status === 403) return 'INVALID_API_KEY';
  if (status === 429) return 'AI_RATE_LIMIT';
  return 'UNKNOWN';
}

/**
 * Parse the display name from an Anthropic model object.
 * Anthropic provides a `display_name` field.
 */
function toDisplayName(raw: Record<string, unknown>): string {
  const name = raw['display_name'];
  if (typeof name === 'string' && name.trim()) return name.trim();
  return typeof raw['id'] === 'string' ? raw['id'] : 'Unknown Model';
}

export class AnthropicProvider implements AIProvider {
  private readonly cacheKey = 'anthropic';
  private readonly baseUrl = 'https://api.anthropic.com/v1';

  readonly requiresApiKey = true;

  private buildHeaders(apiKey: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    };
  }

  async listModels(apiKey: string): Promise<ModelInfo[]> {
    const cached = modelCache.get(this.cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.models;
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/models`, {
        headers: this.buildHeaders(apiKey),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ProviderFetchError('FETCH_FAILED', `Network error fetching Anthropic models: ${msg}`);
    }

    if (!res.ok) {
      const reason = classifyHttpError(res.status);
      throw new ProviderFetchError(reason, `Anthropic GET /v1/models returned HTTP ${res.status}`);
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ProviderFetchError('AI_MALFORMED_OUTPUT', 'Anthropic GET /v1/models returned non-JSON body');
    }

    const raw = body as { data?: unknown[] };
    if (!Array.isArray(raw.data)) {
      throw new ProviderFetchError('AI_MALFORMED_OUTPUT', 'Anthropic GET /v1/models: missing or non-array "data" field');
    }

    const models: ModelInfo[] = [];
    for (const item of raw.data) {
      const model = item as Record<string, unknown>;
      const id = model['id'];
      if (typeof id !== 'string' || !id) continue;

      // Vision detection: capabilities.image_input.supported (native boolean)
      let supportsVision = false;
      const caps = model['capabilities'];
      if (caps !== null && typeof caps === 'object' && !Array.isArray(caps)) {
        const capsObj = caps as Record<string, unknown>;
        const imageInput = capsObj['image_input'];
        if (imageInput !== null && typeof imageInput === 'object' && !Array.isArray(imageInput)) {
          const imageInputObj = imageInput as Record<string, unknown>;
          supportsVision = imageInputObj['supported'] === true;
        }
      }

      models.push({
        id,
        displayName: toDisplayName(model),
        supportsVision,
      });
    }

    modelCache.set(this.cacheKey, { models, fetchedAt: Date.now() });
    return models;
  }

  async critique(req: CritiqueRequest): Promise<CritiqueResult> {
    // Build messages array
    const messages: unknown[] = [];

    if (req.image) {
      // Anthropic vision: image goes in the user message content array
      messages.push({
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: req.image.mimeType,
              data: req.image.base64Data,
            },
          },
          { type: 'text', text: req.prompt },
        ],
      });
    } else {
      messages.push({ role: 'user', content: req.prompt });
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: this.buildHeaders(req.apiKey),
        body: JSON.stringify({
          model: req.modelId,
          max_tokens: 4096,
          system: req.systemInstruction,
          messages,
          tools: [
            {
              name: 'critique_result',
              description: 'Output the structured critique result matching the required schema.',
              input_schema: req.jsonSchema,
            },
          ],
          tool_choice: { type: 'tool', name: 'critique_result' },
        }),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, reason: 'FETCH_FAILED', detail: `Network error: ${msg}` };
    }

    if (!res.ok) {
      const reason = classifyHttpError(res.status);
      return { success: false, reason, detail: `HTTP ${res.status}` };
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { success: false, reason: 'AI_MALFORMED_OUTPUT', detail: 'Non-JSON response from Anthropic /messages' };
    }

    const contentArray = (body as { content?: Array<{ type?: string; text?: string; input?: unknown }> })?.content;
    
    if (!Array.isArray(contentArray)) {
      return { success: false, reason: 'AI_MALFORMED_OUTPUT', detail: 'Invalid content array in Anthropic response' };
    }

    // Look for tool_use first
    const toolUse = contentArray.find((b) => b.type === 'tool_use');
    if (toolUse && toolUse.input) {
      // Stringify the parsed input so the caller's Zod JSON.parse can roundtrip it
      return { success: true, text: JSON.stringify(toolUse.input) };
    }

    // Fallback: did it return a text block?
    const textBlock = contentArray.find((b) => b.type === 'text');
    if (textBlock && textBlock.text) {
      return { success: true, text: textBlock.text };
    }

    return { success: false, reason: 'AI_MALFORMED_OUTPUT', detail: 'Anthropic response missing tool_use and text blocks' };
  }
}
