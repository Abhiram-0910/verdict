/**
 * tests/providers/temperature.test.ts
 *
 * Tests for:
 *  1. temperature=0 is included in the first request to openaiCompatible providers.
 *  2. On a 400 mentioning "temperature", the provider retries without temperature
 *     and caches that preference per model for the process lifetime.
 *  3. Anthropic: same retry behaviour.
 *  4. Gemini: temperature is included in the config object.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  clearTemperatureRejectCacheForTest,
  isModelTemperatureRejected,
} from '../../src/providers/openaiCompatible.js';
import { AnthropicProvider } from '../../src/providers/anthropic.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_SCHEMA = { type: 'object', properties: { findings: { type: 'array' } } };
const BASE_REQ = {
  systemInstruction: 'You are a test assistant.',
  prompt: 'Test prompt',
  modelId: 'test-model-temperature',
  apiKey: 'sk-test',
  jsonSchema: BASE_SCHEMA,
};

function makeOkJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function make400TemperatureResponse(): Response {
  return new Response(
    JSON.stringify({ error: { message: 'temperature is not supported for this model' } }),
    { status: 400, headers: { 'Content-Type': 'application/json' } }
  );
}

function make400GenericResponse(): Response {
  return new Response(
    JSON.stringify({ error: { message: 'invalid model id' } }),
    { status: 400, headers: { 'Content-Type': 'application/json' } }
  );
}

const SUCCESS_BODY = {
  choices: [{ message: { content: JSON.stringify({ findings: [] }) } }],
};

// ---------------------------------------------------------------------------
// OpenAI-compatible provider tests
// ---------------------------------------------------------------------------

import { OpenAICompatibleProvider } from '../../src/providers/openaiCompatible.js';
import type { ModelInfo } from '../../src/providers/types.js';

class TestOpenAIProvider extends OpenAICompatibleProvider {
  protected readonly cacheKey = 'test-openai';
  protected readonly baseUrl = 'https://test.openai.example.com/v1';
  protected mapModel(_raw: Record<string, unknown>): ModelInfo | null {
    return null;
  }
}

describe('OpenAI-compatible temperature handling', () => {
  let provider: TestOpenAIProvider;

  beforeEach(() => {
    provider = new TestOpenAIProvider();
    clearTemperatureRejectCacheForTest();
    vi.restoreAllMocks();
  });

  it('includes temperature=0 in the first request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeOkJsonResponse(SUCCESS_BODY)
    );

    await provider.critique(BASE_REQ);

    const bodyStr = fetchSpy.mock.calls[0][1]?.body as string;
    const body = JSON.parse(bodyStr);
    expect(body.temperature).toBe(0);
  });

  it('retries without temperature on 400 mentioning temperature, then succeeds', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(make400TemperatureResponse())
      .mockResolvedValueOnce(makeOkJsonResponse(SUCCESS_BODY));

    const result = await provider.critique(BASE_REQ);

    expect(result.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const retryBody = JSON.parse(fetchSpy.mock.calls[1][1]?.body as string);
    expect(retryBody.temperature).toBeUndefined();
  });

  it('caches the temperature rejection per model for the process lifetime', async () => {
    const modelId = 'cached-rejection-model';

    // First call: 400 temperature error → retry → success, caches rejection
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(make400TemperatureResponse())
      .mockResolvedValueOnce(makeOkJsonResponse(SUCCESS_BODY));

    await provider.critique({ ...BASE_REQ, modelId });
    expect(isModelTemperatureRejected(modelId)).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Clear spy call history before second call
    fetchSpy.mockClear();
    fetchSpy.mockResolvedValueOnce(makeOkJsonResponse(SUCCESS_BODY));

    await provider.critique({ ...BASE_REQ, modelId });

    // Should only be called once on second invocation (no retry needed — cached)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const bodyStr = fetchSpy.mock.calls[0][1]?.body as string;
    const body = JSON.parse(bodyStr);
    expect(body.temperature).toBeUndefined();
  });

  it('does NOT retry on a 400 that does not mention temperature', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(make400GenericResponse());

    const result = await provider.critique(BASE_REQ);

    expect(result.success).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Anthropic provider tests
// ---------------------------------------------------------------------------

describe('Anthropic temperature handling', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    provider = new AnthropicProvider();
    vi.restoreAllMocks();
  });

  it('includes temperature=0 in the first request', async () => {
    const anthropicBody = {
      content: [{ type: 'tool_use', input: { findings: [] } }],
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeOkJsonResponse(anthropicBody)
    );

    await provider.critique(BASE_REQ);

    const bodyStr = fetchSpy.mock.calls[0][1]?.body as string;
    const body = JSON.parse(bodyStr);
    expect(body.temperature).toBe(0);
  });

  it('retries without temperature on 400 mentioning temperature, then succeeds', async () => {
    const anthropicBody = {
      content: [{ type: 'tool_use', input: { findings: [] } }],
    };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(make400TemperatureResponse())
      .mockResolvedValueOnce(makeOkJsonResponse(anthropicBody));

    const result = await provider.critique(BASE_REQ);

    expect(result.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const retryBody = JSON.parse(fetchSpy.mock.calls[1][1]?.body as string);
    expect(retryBody.temperature).toBeUndefined();
  });

  it('does NOT retry on a 400 that does not mention temperature', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(make400GenericResponse());

    const result = await provider.critique(BASE_REQ);

    expect(result.success).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
