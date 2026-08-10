/**
 * providers/openrouter.ts
 * OpenRouter provider adapter.
 *
 * Model list: public endpoint — no API key required for listModels().
 * Vision detection:
 *   1. architecture.input_modalities must include "image"
 *   2. architecture.output_modalities must NOT include "audio"
 *      — lyria-class models (e.g. lyria-3-pro-preview) have output_modalities
 *        ["text","audio"]. The "text" entry is just metadata; real output is audio.
 *        Excluding models with audio output prevents downstream json_object parse failures.
 * This is documented in the OpenRouter API schema (not an implicit proxy).
 *
 * Critique: standard OpenAI-compatible chat/completions endpoint,
 * but requires Authorization: Bearer for inference calls.
 */

import { OpenAICompatibleProvider, classifyHttpError } from './openaiCompatible.js';
import type { CritiqueRequest, CritiqueResult, ModelInfo } from './types.js';

/**
 * Extract a human-readable display name.
 * OpenRouter model objects include a `name` field.
 * Fall back to the id if absent.
 */
function toDisplayName(raw: Record<string, unknown>): string {
  const name = raw['name'];
  if (typeof name === 'string' && name.trim()) return name.trim();
  return typeof raw['id'] === 'string' ? raw['id'] : 'Unknown Model';
}

export class OpenRouterProvider extends OpenAICompatibleProvider {
  protected readonly cacheKey = 'openrouter';
  protected readonly baseUrl = 'https://openrouter.ai/api/v1';

  /** OpenRouter's /models endpoint is public — no API key required */
  override readonly requiresApiKey = false;

  protected mapModel(raw: Record<string, unknown>): ModelInfo | null {
    const id = raw['id'];
    if (typeof id !== 'string' || !id) return null;

    // architecture.input_modalities: string[] — must include "image"
    // architecture.output_modalities: string[] — must NOT include "audio"
    // Lyria-class models have output_modalities: ["text", "audio"]. The "text" entry
    // is metadata (conditioning prompt echoed back), not a structured JSON response.
    // Their actual output is audio, making them unusable for JSON critique.
    // Excluding any model with "audio" in output_modalities correctly catches this.
    const architecture = raw['architecture'];
    let supportsVision = false;
    if (
      architecture !== null &&
      typeof architecture === 'object' &&
      !Array.isArray(architecture)
    ) {
      const arch = architecture as Record<string, unknown>;
      const inputModalities = arch['input_modalities'];
      const outputModalities = arch['output_modalities'];

      const hasImageInput = Array.isArray(inputModalities) && inputModalities.includes('image');
      // Exclude if output modalities include 'audio' — these are music/audio generation
      // models that cannot produce structured JSON critique responses.
      const hasAudioOutput = Array.isArray(outputModalities) && outputModalities.includes('audio');

      supportsVision = hasImageInput && !hasAudioOutput;
    }

    return {
      id,
      displayName: toDisplayName(raw),
      supportsVision,
    };
  }

  protected override async doCritique(req: CritiqueRequest, signal?: AbortSignal): Promise<CritiqueResult> {
    const messages: unknown[] = [];

    const systemInstruction = req.systemInstruction
      ? `${req.systemInstruction}\n\nIMPORTANT: You must output a JSON object matching this schema:\n${JSON.stringify(req.jsonSchema)}`
      : `IMPORTANT: You must output a JSON object matching this schema:\n${JSON.stringify(req.jsonSchema)}`;

    messages.push({ role: 'system', content: systemInstruction });

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
          'HTTP-Referer': 'https://verdict.com',
          'X-Title': 'Verdict',
        },
        signal,
        body: JSON.stringify({
          model: req.modelId,
          max_tokens: 4000,
          messages,
          response_format: { type: 'json_object' },
        }),
      });
    } catch (err: unknown) {
      // Re-throw AbortError so the parent critique() can classify it as TIMEOUT.
      if (err instanceof Error && err.name === 'AbortError') throw err;
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
