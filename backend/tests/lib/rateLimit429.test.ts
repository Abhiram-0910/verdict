/**
 * tests/lib/rateLimit429.test.ts
 *
 * Tests for item 9: free-tier 429 response includes resetAt (ISO 8601) and
 * a Retry-After header.
 *
 * Also tests production / non-production CORS origin behaviour (item 4).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildServer } from '../../src/server.js';
import { resetIpUsageForTest } from '../../src/lib/rateLimit.js';
import { db, auditJob } from '../../src/db/index.js';
import * as sessionModule from '../../src/capture/session.js';
import * as queueModule from '../../src/capture/queue.js';

async function buildTestServer(env?: Record<string, string>) {
  if (env) {
    for (const [k, v] of Object.entries(env)) {
      process.env[k] = v;
    }
  }
  return buildServer();
}

describe('POST /api/audits — 429 body includes resetAt and Retry-After header', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let captureSpy: ReturnType<typeof vi.spyOn>;
  let insertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // Allow exactly 1 audit per window
    process.env.RATE_LIMIT_FREE_AUDITS_PER_DAY = '1';
    resetIpUsageForTest();
    queueModule.resetQueueForTest();

    captureSpy = vi.spyOn(sessionModule, 'runQueuedCapture').mockResolvedValue({
      error: false,
      desktopScreenshotUrl: 'https://example.com/d.png',
      mobileScreenshotUrl: 'https://example.com/m.png',
      webVitals: { loadTimeMs: 100, lcp: null, cls: null },
      accessibilityViolations: [],
      renderedText: 'Test',
      partial: false,
      partialReason: null,
    });

    insertSpy = vi.spyOn(db, 'insert').mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'test-job-uuid' }]),
      }),
    } as any);

    app = await buildTestServer();
  });

  afterEach(async () => {
    captureSpy.mockRestore();
    insertSpy.mockRestore();
    await app.close();
    delete process.env.RATE_LIMIT_FREE_AUDITS_PER_DAY;
    resetIpUsageForTest();
  });

  it('returns resetAt (ISO 8601) and Retry-After header on 429', async () => {
    // First request — should succeed (uses up the 1-audit limit)
    const first = await app.inject({
      method: 'POST',
      url: '/api/audits',
      payload: { url: 'https://example.com' },
    });
    expect(first.statusCode).toBe(202);

    // Second request — should be rate-limited
    const second = await app.inject({
      method: 'POST',
      url: '/api/audits',
      payload: { url: 'https://example.com' },
    });

    expect(second.statusCode).toBe(429);

    const body = second.json();
    expect(body).toHaveProperty('resetAt');
    // resetAt must be a valid ISO 8601 date string
    expect(() => new Date(body.resetAt).toISOString()).not.toThrow();
    // resetAt must be in the future
    expect(new Date(body.resetAt).getTime()).toBeGreaterThan(Date.now());

    // Retry-After header must be present and be a non-negative integer string
    const retryAfter = second.headers['retry-after'];
    expect(retryAfter).toBeDefined();
    const retryAfterNum = parseInt(retryAfter as string, 10);
    expect(Number.isInteger(retryAfterNum)).toBe(true);
    expect(retryAfterNum).toBeGreaterThanOrEqual(0);

    // Existing fields must still be present (no regression)
    expect(body.error).toBe('Rate limit exceeded');
    expect(body.detail).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Item 4: CORS — dev-only origin allowed only in non-production
// ---------------------------------------------------------------------------

describe('CORS — http://127.0.0.1:3000 origin', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(async () => {
    await app.close();
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('allows http://127.0.0.1:3000 in development (NODE_ENV != production)', async () => {
    process.env.NODE_ENV = 'development';
    process.env.FRONTEND_URL = 'https://verdict.vercel.app';
    app = await buildServer();

    const res = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        Origin: 'http://127.0.0.1:3000',
        'Access-Control-Request-Method': 'GET',
      },
    });

    // Fastify CORS returns 204 for preflight with the correct origin
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:3000');
  });

  it('blocks http://127.0.0.1:3000 in production (NODE_ENV === production)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'https://verdict.vercel.app';
    process.env.COOKIE_SECRET = 'a-sufficiently-long-test-secret-value-32chars';
    app = await buildServer();

    const res = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        Origin: 'http://127.0.0.1:3000',
        'Access-Control-Request-Method': 'GET',
      },
    });

    // Fastify CORS should NOT include access-control-allow-origin for blocked origin
    expect(res.headers['access-control-allow-origin']).not.toBe('http://127.0.0.1:3000');
  });

  it('always allows the deployed FRONTEND_URL in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'https://verdict.vercel.app';
    process.env.COOKIE_SECRET = 'a-sufficiently-long-test-secret-value-32chars';
    app = await buildServer();

    const res = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        Origin: 'https://verdict.vercel.app',
        'Access-Control-Request-Method': 'GET',
      },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://verdict.vercel.app');
  });
});
