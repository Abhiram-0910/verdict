import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../../src/server.js';
import * as sessionModule from '../../src/capture/session.js';
import * as queueModule from '../../src/capture/queue.js';
import { db, auditJob } from '../../src/db/index.js';
import {
  clearByokKeyCache,
  resetInFlightIps,
  resetByokRateLimits,
  resetGlobalBudget,
  setCircuitBreakerUntil,
} from '../../src/lib/abuseControl.js';

describe('POST /api/audits - Abuse, BYOK, and Queue Defenses', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let captureSpy: any;
  let insertSpy: any;

  beforeEach(async () => {
    clearByokKeyCache();
    resetInFlightIps();
    resetByokRateLimits();
    resetGlobalBudget();
    queueModule.resetQueueForTest();
    setCircuitBreakerUntil(null);

    captureSpy = vi.spyOn(sessionModule, 'runQueuedCapture').mockResolvedValue({
      error: false,
      desktopScreenshotUrl: 'https://example.com/desktop.png',
      mobileScreenshotUrl: 'https://example.com/mobile.png',
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

    app = await buildServer();
  });

  afterEach(async () => {
    captureSpy.mockRestore();
    insertSpy.mockRestore();
    await app.close();
  });

  it('rejects private IP literal at POST with 400 and never touches queue or starts Chromium', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/audits',
      payload: {
        url: 'http://127.0.0.1/',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.detail).toContain('Audits cannot be performed on private');
    expect(captureSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects decimal and IPv4-mapped IPv6 IP literals at POST with 400', async () => {
    const resDecimal = await app.inject({
      method: 'POST',
      url: '/api/audits',
      payload: {
        url: 'http://2130706433/', // 127.0.0.1 in decimal
      },
    });
    expect(resDecimal.statusCode).toBe(400);
    expect(captureSpy).not.toHaveBeenCalled();

    const resIpv6Mapped = await app.inject({
      method: 'POST',
      url: '/api/audits',
      payload: {
        url: 'http://[::ffff:127.0.0.1]/',
      },
    });
    expect(resIpv6Mapped.statusCode).toBe(400);
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it('spy proves a junk BYOK key never reaches capture, key never logged, returns 401 INVALID_API_KEY', async () => {
    // Mock global fetch to return 401 for junk key
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Invalid API Key' }),
    } as any);

    const logWarnSpy = vi.spyOn(console, 'warn');
    const logErrSpy = vi.spyOn(console, 'error');

    const junkKey = 'sk-invalid-super-secret-key-999';

    const res = await app.inject({
      method: 'POST',
      url: '/api/audits',
      payload: {
        url: 'https://example.com',
        byokProvider: 'openai',
        byokApiKey: junkKey,
        byokModel: 'gpt-4o',
      },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBe('INVALID_API_KEY');

    // Spy proves capture was never enqueued
    expect(captureSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();

    // Verify key was never logged to console.warn or console.error
    for (const call of [...logWarnSpy.mock.calls, ...logErrSpy.mock.calls]) {
      const line = JSON.stringify(call);
      expect(line).not.toContain(junkKey);
    }

    fetchSpy.mockRestore();
    logWarnSpy.mockRestore();
    logErrSpy.mockRestore();
  });

  it('enforces at most 1 pending-or-running job per IP (returns 429)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
    } as any);

    // First request succeeds
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/audits',
      remoteAddress: '192.0.2.1',
      payload: {
        url: 'https://example.com',
        byokProvider: 'openai',
        byokApiKey: 'sk-valid-key',
        byokModel: 'gpt-4o',
      },
    });
    expect(res1.statusCode).toBe(202);

    // Second request from same IP while first is in-flight returns 429
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/audits',
      remoteAddress: '192.0.2.1',
      payload: {
        url: 'https://example.com',
        byokProvider: 'openai',
        byokApiKey: 'sk-valid-key',
        byokModel: 'gpt-4o',
      },
    });
    expect(res2.statusCode).toBe(429);
    expect(res2.json().detail).toContain('already in progress for this IP');

    fetchSpy.mockRestore();
  });

  it('caps pending jobs with 503 BUSY and retryAfterSeconds', async () => {
    process.env.MAX_PENDING_JOBS = '1';

    // Fill queue with 2 dummy jobs (1 running + 1 pending in queue)
    queueModule.enqueue(() => new Promise(() => {}));
    queueModule.enqueue(() => new Promise(() => {}));

    const res = await app.inject({
      method: 'POST',
      url: '/api/audits',
      remoteAddress: '192.0.2.99',
      payload: {
        url: 'https://example.com',
      },
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.code).toBe('BUSY');
    expect(body.retryAfterSeconds).toBe(30);

    delete process.env.MAX_PENDING_JOBS;
  });

  it('trips circuit breaker blocks default path with 503 AI_QUOTA_EXHAUSTED', async () => {
    const resetTime = new Date(Date.now() + 60 * 60 * 1000);
    setCircuitBreakerUntil(resetTime);

    const res = await app.inject({
      method: 'POST',
      url: '/api/audits',
      payload: {
        url: 'https://example.com',
      },
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.code).toBe('AI_QUOTA_EXHAUSTED');
    expect(body.resetAt).toBe(resetTime.toISOString());
    expect(captureSpy).not.toHaveBeenCalled();
  });
});
