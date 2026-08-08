/**
 * providers/gemini.ts
 * Gemini (Google AI Studio) provider adapter.
 *
 * Auth: x-goog-api-key header (or ?key= query param — using header here).
 * Models: GET https://generativelanguage.googleapis.com/v1beta/models
 *
 * Vision detection (per confirmed design decision — see AGENTS.md BYOK Step 1):
 *   Include a model if AND ONLY IF:
 *   1. supportedGenerationMethods includes "generateContent"
 *   2. Name does NOT match any exclusion pattern (embedding, aqa, tts)
 *   If vision support can't be confirmed past these criteria, EXCLUDE the model.
 *   This is the same conservative principle as AuditScore never defaulting
 *   to a fake value — silently including a non-vision model breaks the Visual
 *   Critique agent downstream.
 *
 * Critique: uses the @google/genai SDK (reusing the existing 429-retry logic
 * from lib/gemini.ts). The lib/gemini.ts file is NOT deleted in this step;
 * it is preserved for backward compatibility with visualCritique.ts and
 * copyCritique.ts until the wiring step.
 */

import { GoogleGenAI, type Part } from '@google/genai';
import type { AIProvider, CritiqueRequest, CritiqueResult, ModelInfo } from './types.js';
import { ProviderFetchError } from './openaiCompatible.js';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

// Exclusion patterns: if a model name contains any of these substrings,
// it is NOT a vision-capable generative model and must be excluded.
const EXCLUSION_PATTERNS: readonly string[] = ['embedding', 'aqa', 'tts'];

interface CacheEntry {
  models: ModelInfo[];
  fetchedAt: number;
}

const modelCache = new Map<string, CacheEntry>();

/**
 * Determine if a Gemini model should be included in the vision-capable list.
 * Conservative: only include if generateContent is supported AND no exclusion pattern matches.
 */
function isVisionCapableGeminiModel(raw: Record<string, unknown>): boolean {
  const name = typeof raw['name'] === 'string' ? raw['name'] : '';

  // Exclusion: model name contains any forbidden substring (case-insensitive)
  const nameLower = name.toLowerCase();
  if (EXCLUSION_PATTERNS.some((p) => nameLower.includes(p))) return false;

  // Inclusion: must support generateContent
  const methods = raw['supportedGenerationMethods'];
  if (!Array.isArray(methods)) return false;
  return methods.includes('generateContent');
}

/**
 * Build a clean display name from the Gemini model's displayName or name fields.
 * Gemini API returns displayName (e.g. "Gemini 1.5 Flash") on most models.
 */
function toDisplayName(raw: Record<string, unknown>): string {
  const displayName = raw['displayName'];
  if (typeof displayName === 'string' && displayName.trim()) return displayName.trim();
  // Fall back to the name field, stripping the "models/" prefix
  const name = typeof raw['name'] === 'string' ? raw['name'] : '';
  return name.replace(/^models\//, '');
}

/**
 * Extract the bare model ID from the "models/{id}" name format.
 */
function toModelId(raw: Record<string, unknown>): string {
  const name = typeof raw['name'] === 'string' ? raw['name'] : '';
  return name.replace(/^models\//, '') || name;
}

export class GeminiProvider implements AIProvider {
  private readonly cacheKey = 'gemini';

  readonly requiresApiKey = true;

  async listModels(apiKey: string): Promise<ModelInfo[]> {
    const cached = modelCache.get(this.cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.models;
    }

    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/models?key=${encodeURIComponent(apiKey)}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ProviderFetchError('FETCH_FAILED', `Network error fetching Gemini models: ${msg}`);
    }

    if (!res.ok) {
      const reason = res.status === 400 || res.status === 401 || res.status === 403
        ? 'INVALID_API_KEY'
        : res.status === 429 ? 'AI_RATE_LIMIT' : 'UNKNOWN';
      throw new ProviderFetchError(reason, `Gemini GET /v1beta/models returned HTTP ${res.status}`);
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ProviderFetchError('AI_MALFORMED_OUTPUT', 'Gemini GET /v1beta/models returned non-JSON body');
    }

    const raw = body as { models?: unknown[] };
    if (!Array.isArray(raw.models)) {
      throw new ProviderFetchError('AI_MALFORMED_OUTPUT', 'Gemini GET /v1beta/models: missing or non-array "models" field');
    }

    const models: ModelInfo[] = [];
    for (const item of raw.models) {
      const model = item as Record<string, unknown>;
      if (!isVisionCapableGeminiModel(model)) continue;

      models.push({
        id: toModelId(model),
        displayName: toDisplayName(model),
        supportsVision: true, // we only include confirmed vision-capable models
      });
    }

    modelCache.set(this.cacheKey, { models, fetchedAt: Date.now() });
    return models;
  }

  async critique(req: CritiqueRequest): Promise<CritiqueResult> {
    // Reuse the SDK's generateContent with per-request key instantiation.
    // We do NOT reuse the module-level `ai` singleton from lib/gemini.ts
    // because that reads the key from env at import time; here the key
    // comes from the request.
    const ai = new GoogleGenAI({ apiKey: req.apiKey });

    const parts: Part[] = [{ text: req.prompt }];
    if (req.image) {
      parts.push({
        inlineData: {
          mimeType: req.image.mimeType,
          data: req.image.base64Data,
        },
      });
    }

    // 429 retry — same logic as lib/gemini.ts, self-contained here
    const maxRetries = 3;
    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        const response = await ai.models.generateContent({
          model: req.modelId,
          config: {
            systemInstruction: req.systemInstruction,
            responseMimeType: 'application/json',
            responseJsonSchema: req.jsonSchema,
          } as any,
          contents: [{ role: 'user', parts }],
        });

        const text = response.text ?? null;
        if (!text) {
          return { success: false, reason: 'AI_MALFORMED_OUTPUT', detail: 'Gemini returned empty text response' };
        }
        return { success: true, text };
      } catch (error: unknown) {
        const err = error as { status?: number; message?: string };
        if (err?.status === 429 || err?.message?.includes('429')) {
          if (attempt >= maxRetries) {
            return { success: false, reason: 'AI_RATE_LIMIT', detail: `Gemini rate limit after ${maxRetries} retries` };
          }
          const delayMs = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          attempt++;
        } else {
          const msg = err?.message ?? String(error);
          return { success: false, reason: 'UNKNOWN', detail: msg };
        }
      }
    }

    return { success: false, reason: 'UNKNOWN', detail: 'Unreachable' };
  }
}
