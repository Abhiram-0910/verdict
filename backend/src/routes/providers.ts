/**
 * routes/providers.ts
 * POST /api/providers/models
 *
 * Body: { provider: ProviderName, apiKey?: string }
 * Returns: ModelInfo[] filtered to supportsVision === true
 *
 * Key-handling rules (per spec §5):
 * - apiKey is never written to any DB table
 * - apiKey is redacted from pino logs (configured in server.ts)
 * - apiKey is in the POST body, never in query params (avoids server logs + browser history)
 * - No caching of the key itself; only the model list response is cached (in-process, per provider)
 * - apiKey is optional in the schema; whether it is required is determined at runtime
 *   by the provider's requiresApiKey flag (e.g. OpenRouter does not need one for listModels)
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getProvider } from '../providers/index.js';
import { ProviderFetchError } from '../providers/openaiCompatible.js';
import type { ProviderName } from '../providers/types.js';

const PROVIDER_NAMES: readonly ProviderName[] = ['gemini', 'openai', 'anthropic', 'xai', 'openrouter'];

const requestSchema = z.object({
  provider: z.enum(PROVIDER_NAMES as [ProviderName, ...ProviderName[]]),
  // apiKey is optional at the schema level.
  // Whether a missing key is a 400 depends on the provider's requiresApiKey flag.
  apiKey: z.string().min(1).optional(),
});

export default async function providersRoutes(fastify: FastifyInstance) {
  fastify.post('/api/providers/models', async (request, reply) => {
    // 1. Validate input shape
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Bad Request',
        detail: parsed.error.issues.map((i) => i.message).join('; '),
      });
    }

    const { provider, apiKey } = parsed.data;
    const adapter = getProvider(provider);

    // 2. Key-requirement gate — checked at runtime against the provider's flag
    if (adapter.requiresApiKey && !apiKey) {
      return reply.status(400).send({
        error: 'Bad Request',
        detail: `apiKey is required for provider "${provider}"`,
      });
    }

    // 3. Fetch model list from provider (may use in-process cache)
    let allModels;
    try {
      // Pass the key through; providers where requiresApiKey === false
      // receive an empty string and ignore it.
      allModels = await adapter.listModels(apiKey ?? '');
    } catch (err: unknown) {
      if (err instanceof ProviderFetchError) {
        const statusMap: Record<string, number> = {
          INVALID_API_KEY: 401,
          AI_RATE_LIMIT: 429,
          FETCH_FAILED: 502,
          AI_MALFORMED_OUTPUT: 502,
          UNKNOWN: 500,
        };
        const status = statusMap[err.reason] ?? 500;
        return reply.status(status).send({
          error: err.reason,
          detail: err.message,
        });
      }
      // Unexpected error
      fastify.log.error({ err }, 'Unexpected error in POST /api/providers/models');
      return reply.status(500).send({ error: 'UNKNOWN', detail: 'Internal server error' });
    }

    // 4. Filter to vision-capable models only
    const visionModels = allModels.filter((m) => m.supportsVision);

    return reply.send(visionModels);
  });
}
