/**
 * providers/types.ts
 * Shared interfaces, types, and canonical error reason codes
 * for the BYOK provider-abstraction layer.
 */

// ---------------------------------------------------------------------------
// Canonical error reason codes
// These are the same codes used throughout the agents (visualCritique.ts,
// copyCritique.ts). Centralised here so every provider maps to them rather
// than each file re-defining its own union.
// ---------------------------------------------------------------------------
export type ProviderErrorReason =
  | 'AI_RATE_LIMIT'        // 429 from provider
  | 'AI_MALFORMED_OUTPUT'  // Unexpected / unparseable JSON from provider
  | 'FETCH_FAILED'         // Network error reaching the provider's API
  | 'DB_WRITE_FAILED'      // Persistence failure (used by callers, not providers)
  | 'INVALID_API_KEY'      // 401 / 403 from provider
  | 'UNKNOWN';             // Anything else

// ---------------------------------------------------------------------------
// Model info
// ---------------------------------------------------------------------------
export interface ModelInfo {
  /** Provider-native model identifier (e.g. "gpt-4o", "claude-opus-4-5") */
  id: string;
  /** Human-readable name for the UI picker */
  displayName: string;
  /** True if this model accepts image inputs (screenshot critique use-case) */
  supportsVision: boolean;
}

// ---------------------------------------------------------------------------
// Critique request / result
// These are provider-agnostic. The agents pass in a prepared prompt + image
// bytes; the provider adapter handles the SDK/HTTP translation internally.
// ---------------------------------------------------------------------------
export interface CritiqueRequest {
  /** Plain-text system instruction */
  systemInstruction: string;
  /** Plain-text user prompt */
  prompt: string;
  /** Optional image for vision critique (base64-encoded bytes + mime type) */
  image?: {
    base64Data: string;
    mimeType: string;
  };
  /**
   * JSON Schema describing the desired structured output.
   * Derived from the agent's Zod schema using zod-to-json-schema.
   */
  jsonSchema: Record<string, unknown>;
  /** The model ID to use for this request */
  modelId: string;
  /** The API key to authenticate the request */
  apiKey: string;
}

export type CritiqueResult =
  | { success: true; text: string }
  | { success: false; reason: ProviderErrorReason; detail: string };

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------
export interface AIProvider {
  /**
   * Whether this provider requires an API key to list models.
   * Providers with a public model-list endpoint (e.g. OpenRouter) set this
   * to false; all others set it to true.
   * The route layer uses this to decide whether a missing apiKey is a 400.
   */
  readonly requiresApiKey: boolean;

  /**
   * Fetch the list of models available for this provider.
   * apiKey is guaranteed to be a non-empty string when requiresApiKey is true.
   * When requiresApiKey is false, apiKey is an empty string and may be ignored.
   */
  listModels(apiKey: string): Promise<ModelInfo[]>;

  /**
   * Run a text (or vision) critique request against the provider.
   * Returns the raw model text response for the caller to Zod-validate.
   */
  critique(req: CritiqueRequest): Promise<CritiqueResult>;
}

// ---------------------------------------------------------------------------
// Provider name union (the registry key)
// ---------------------------------------------------------------------------
export type ProviderName = 'gemini' | 'openai' | 'anthropic' | 'xai' | 'openrouter';
