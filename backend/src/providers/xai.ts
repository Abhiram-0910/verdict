/**
 * providers/xai.ts
 * xAI (Grok) provider adapter.
 *
 * Vision detection: xAI's GET /v1/models includes a `prompt_image_token_price`
 * field on vision-capable models. We treat prompt_image_token_price > 0 as
 * the supportsVision signal.
 *
 * This is an implicit proxy, not a documented API contract. If xAI ever
 * ships a dedicated capability field, prefer that instead and update this
 * adapter accordingly. The proxy has been explicitly approved — see AGENTS.md
 * Session 10 / BYOK Step 1 plan review.
 * 
 * Critique: inherits the OpenAI-compatible json_schema approach, which xAI
 * matches documented OpenAI-compatible spec, live-unverified — pending API key.
 */

import { OpenAICompatibleProvider } from './openaiCompatible.js';
import type { ModelInfo } from './types.js';

function toDisplayName(id: string): string {
  // e.g. "grok-4-5" → "Grok 4 5", "grok-2-vision" → "Grok 2 Vision"
  return id
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export class XAIProvider extends OpenAICompatibleProvider {
  protected readonly cacheKey = 'xai';
  protected readonly baseUrl = 'https://api.x.ai/v1';

  protected mapModel(raw: Record<string, unknown>): ModelInfo | null {
    const id = raw['id'];
    if (typeof id !== 'string') return null;

    // xAI may surface internal/system models — skip anything without a real id
    if (!id || id.startsWith('_')) return null;

    // Vision proxy: prompt_image_token_price > 0 indicates vision capability.
    // If the field is absent or 0, we conservatively mark supportsVision false.
    const imagePrice = raw['prompt_image_token_price'];
    const supportsVision =
      typeof imagePrice === 'number' && imagePrice > 0;

    return {
      id,
      displayName: toDisplayName(id),
      supportsVision,
    };
  }
}
