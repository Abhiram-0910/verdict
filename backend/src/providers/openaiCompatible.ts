/**
 * providers/openaiCompatible.ts
 * Base class for all OpenAI-API-compatible providers
 * (OpenAI, xAI, OpenRouter).
 *
 * Handles:
 * - Authorization: Bearer header
 * - GET /v1/models response parsing
 * - In-process model-list cache (~1 hour TTL, keyed by provider name, NOT by key)
 * - Error normalisation → ProviderErrorReason
 * - POST to /v1/chat/completions for critique()
 */

import type { AIProvider, CritiqueRequest, CritiqueResult, ModelInfo, ProviderErrorReason } from './types.js';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  models: ModelInfo[];
  fetchedAt: number;
}

// One shared cache map; keyed by provider name (not key — see spec §4)
const modelCache = new Map<string, CacheEntry>();

/**
 * Parse an HTTP error response into a canonical ProviderErrorReason.
 */
export function classifyHttpError(status: number): ProviderErrorReason {
  if (status === 401 || status === 403) return 'INVALID_API_KEY';
  if (status === 429) return 'AI_RATE_LIMIT';
  return 'UNKNOWN';
}

/**
 * Base class for OpenAI-compatible providers.
 * Subclasses must supply:
 *   - cacheKey   : unique stable string for the in-process cache
 *   - baseUrl    : e.g. 'https://api.openai.com/v1'
 *   - mapModel() : transform one raw model record into ModelInfo
 */
export abstract class OpenAICompatibleProvider implements AIProvider {
  protected abstract readonly cacheKey: string;
  protected abstract readonly baseUrl: string;

  /** Default: all OpenAI-compatible providers require a key to list models. */
  readonly requiresApiKey: boolean = true;

  /**
   * Map a single raw model object from GET /v1/models into a ModelInfo.
   * Return null to exclude the model (e.g. fine-tune, embeddings, etc.)
   */
  protected abstract mapModel(raw: Record<string, unknown>): ModelInfo | null;

  async listModels(apiKey: string): Promise<ModelInfo[]> {
    // Cache hit?
    const cached = modelCache.get(this.cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.models;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.requiresApiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/models`, { headers });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ProviderFetchError('FETCH_FAILED', `Network error fetching models: ${msg}`);
    }

    if (!res.ok) {
      const reason = classifyHttpError(res.status);
      throw new ProviderFetchError(reason, `GET /v1/models returned HTTP ${res.status}`);
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ProviderFetchError('AI_MALFORMED_OUTPUT', 'GET /v1/models returned non-JSON body');
    }

    const raw = body as { data?: unknown[] };
    if (!Array.isArray(raw.data)) {
      throw new ProviderFetchError('AI_MALFORMED_OUTPUT', 'GET /v1/models: missing or non-array "data" field');
    }

    const models: ModelInfo[] = [];
    for (const item of raw.data) {
      const mapped = this.mapModel(item as Record<string, unknown>);
      if (mapped !== null) models.push(mapped);
    }

    // Populate cache
    modelCache.set(this.cacheKey, { models, fetchedAt: Date.now() });
    return models;
  }

  async critique(req: CritiqueRequest): Promise<CritiqueResult> {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt <= maxRetries) {
      const result = await this.doCritique(req);
      
      if (!result.success && result.reason === 'AI_RATE_LIMIT') {
        if (attempt >= maxRetries) {
          return { success: false, reason: 'AI_RATE_LIMIT', detail: `Rate limit after ${maxRetries} retries` };
        }
        const delayMs = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        attempt++;
        continue;
      }
      
      return result;
    }
    
    return { success: false, reason: 'UNKNOWN', detail: 'Unreachable' };
  }

  /**
   * Perform the actual fetch to chat/completions.
   * Overridden by OpenRouter to change the response_format.
   */
  protected async doCritique(req: CritiqueRequest): Promise<CritiqueResult> {
    const messages: unknown[] = [];

    if (req.systemInstruction) {
      messages.push({ role: 'system', content: req.systemInstruction });
    }

    // Build user content — text, or text + image for vision
    if (req.image) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: req.prompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:${req.image.mimeType};base64,${req.image.base64Data}`,
            },
          },
        ],
      });
    } else {
      messages.push({ role: 'user', content: req.prompt });
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${req.apiKey}`,
        },
        body: JSON.stringify({
          model: req.modelId,
          max_tokens: 4000,
          messages,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'critique_result',
              schema: req.jsonSchema,
              strict: true,
            },
          },
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
      return { success: false, reason: 'AI_MALFORMED_OUTPUT', detail: 'Non-JSON response from chat/completions' };
    }

    const text = (body as { choices?: Array<{ message?: { content?: string } }> })
      ?.choices?.[0]?.message?.content ?? null;

    if (!text) {
      return { success: false, reason: 'AI_MALFORMED_OUTPUT', detail: 'Empty content in chat/completions response' };
    }

    return { success: true, text };
  }
}

/**
 * Internal error class for structured errors thrown out of listModels().
 * Route handler catches this and translates to HTTP response.
 */
export class ProviderFetchError extends Error {
  constructor(
    public readonly reason: ProviderErrorReason,
    message: string
  ) {
    super(message);
    this.name = 'ProviderFetchError';
  }
}
