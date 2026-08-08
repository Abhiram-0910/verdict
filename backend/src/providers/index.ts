/**
 * providers/index.ts
 * Provider registry / factory.
 *
 * Given a ProviderName, returns the corresponding AIProvider instance.
 * Instances are singletons — the same object is reused across requests.
 * (Model-list cache lives inside each provider, keyed by provider name,
 * not by API key — per spec §4.)
 */

import { GeminiProvider } from './gemini.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { XAIProvider } from './xai.js';
import { OpenRouterProvider } from './openrouter.js';
import type { AIProvider, ProviderName } from './types.js';

// Singleton instances
const registry: Record<ProviderName, AIProvider> = {
  gemini: new GeminiProvider(),
  openai: new OpenAIProvider(),
  anthropic: new AnthropicProvider(),
  xai: new XAIProvider(),
  openrouter: new OpenRouterProvider(),
};

/**
 * Returns the AIProvider instance for the given provider name.
 * Throws if the name is not recognised (should be caught at the Zod
 * validation layer in the route before reaching here).
 */
export function getProvider(name: ProviderName): AIProvider {
  return registry[name];
}

// Re-export types for convenience
export type { AIProvider, ModelInfo, CritiqueRequest, CritiqueResult, ProviderName } from './types.js';
