/**
 * providers/openai.ts
 * OpenAI provider adapter.
 *
 * Vision detection gap: OpenAI's GET /v1/models response returns only
 * { id, object, created, owned_by } with NO capability flags.
 * A maintained allowlist is the only reliable approach.
 *
 * See ARCHITECTURE.md § Known Technical Debt for the maintenance notice.
 */

import { OpenAICompatibleProvider } from './openaiCompatible.js';
import type { ModelInfo } from './types.js';

/**
 * VISION_MODEL_PREFIXES — maintained allowlist of OpenAI model ID prefixes
 * that are confirmed vision-capable (multimodal image input supported).
 *
 * MAINTENANCE REQUIRED: This list must be updated manually whenever OpenAI
 * releases new vision-capable models. See ARCHITECTURE.md § Known Technical
 * Debt for the full maintenance notice.
 *
 * Last verified: 2026-07-30
 * Sources: https://platform.openai.com/docs/models
 */
export const VISION_MODEL_PREFIXES: readonly string[] = [
  'gpt-4o',          // gpt-4o, gpt-4o-mini, gpt-4o-2024-xx
  'gpt-4-turbo',     // gpt-4-turbo, gpt-4-turbo-preview, gpt-4-turbo-2024-04-09
  'gpt-4-vision',    // gpt-4-vision-preview (legacy, still served)
  'chatgpt-4o',      // chatgpt-4o-latest
  'o1',              // o1, o1-mini, o1-preview (vision enabled in o1 family)
  'o3',              // o3, o3-mini
  'o4',              // o4-mini
];

/**
 * Check whether a model ID matches any vision-capable prefix.
 * Uses exact prefix matching (not substring) to avoid false positives
 * like a hypothetical "not-gpt-4o-..." model.
 */
function isVisionModel(id: string): boolean {
  return VISION_MODEL_PREFIXES.some((prefix) => id.startsWith(prefix));
}

/**
 * Human-readable display name from a raw OpenAI model ID.
 * Best-effort — the API doesn't provide a display name field.
 */
function toDisplayName(id: string): string {
  // Capitalise and replace hyphens for readability
  return id
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Substrings that disqualify a model from being vision-capable,
 * even if its ID matches a vision prefix. Applied AFTER prefix matching.
 * Examples: gpt-4o-transcribe, gpt-4o-mini-tts, gpt-4o-search-preview
 * are audio/search variants that share the gpt-4o prefix but do not
 * accept image inputs.
 */
const VISION_EXCLUSION_SUFFIXES: readonly string[] = [
  'transcribe',
  '-tts',
  'search-preview',
  'diarize',
];

export class OpenAIProvider extends OpenAICompatibleProvider {
  protected readonly cacheKey = 'openai';
  protected readonly baseUrl = 'https://api.openai.com/v1';

  protected mapModel(raw: Record<string, unknown>): ModelInfo | null {
    const id = raw['id'];
    if (typeof id !== 'string') return null;

    // Exclude fine-tune base models, embeddings, whisper, tts, dall-e, etc.
    // Only keep chat-completion-capable models.
    const excludePrefixes = ['ft:', 'text-embedding', 'whisper', 'tts', 'dall-e', 'davinci', 'babbage', 'curie', 'ada'];
    if (excludePrefixes.some((p) => id.startsWith(p))) return null;

    // Check vision: prefix must match AND no disqualifying suffix must be present.
    const prefixMatches = isVisionModel(id);
    const suffixDisqualifies = VISION_EXCLUSION_SUFFIXES.some((s) => id.includes(s));
    const supportsVision = prefixMatches && !suffixDisqualifies;

    return {
      id,
      displayName: toDisplayName(id),
      supportsVision,
    };
  }
}
