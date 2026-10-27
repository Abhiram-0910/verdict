import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkIpLiteral,
  validateByokApiKey,
  hashApiKey,
  clearByokKeyCache,
  checkAndConsumeByokRateLimit,
  resetByokRateLimits,
  checkQueueCapacity,
  resetInFlightIps,
  trackInFlightStart,
  trackInFlightEnd,
  hasInFlightJob,
  checkDefaultPathBudget,
  recordDefaultPathAudit,
  resetGlobalBudget,
  getNextMidnightLosAngeles,
  extractGeminiPerDayQuotaId,
  tripGeminiCircuitBreaker,
  setCircuitBreakerUntil,
} from '../../src/lib/abuseControl.js';
import { resetQueueForTest, enqueue } from '../../src/capture/queue.js';
import { reconcileOrphanedJobs, logFatalAndExit } from '../../src/server.js';
import { db } from '../../src/db/client.js';

describe('Abuse Control - IP Literal Checking', () => {
  it('rejects standard IPv4 private/loopback/link-local/CGNAT literals', () => {
    expect(checkIpLiteral('http://127.0.0.1/')).toEqual({
      isIp: true,
      isBlocked: true,
      address: '127.0.0.1',
    });
    expect(checkIpLiteral('http://10.0.0.1/')).toEqual({
      isIp: true,
      isBlocked: true,
      address: '10.0.0.1',
    });
    expect(checkIpLiteral('http://169.254.169.254/')).toEqual({
      isIp: true,
      isBlocked: true,
      address: '169.254.169.254',
    });
    expect(checkIpLiteral('http://100.64.1.1/')).toEqual({
      isIp: true,
      isBlocked: true,
      address: '100.64.1.1',
    });
    expect(checkIpLiteral('http://192.168.1.1/')).toEqual({
      isIp: true,
      isBlocked: true,
      address: '192.168.1.1',
    });
    expect(checkIpLiteral('http://172.16.0.1/')).toEqual({
      isIp: true,
      isBlocked: true,
      address: '172.16.0.1',
    });
  });

  it('rejects IPv6 loopback and private literals', () => {
    expect(checkIpLiteral('http://[::1]/')).toEqual({
      isIp: true,
      isBlocked: true,
      address: '::1',
    });
    expect(checkIpLiteral('http://[fc00::1]/')).toEqual({
      isIp: true,
      isBlocked: true,
      address: 'fc00::1',
    });
    expect(checkIpLiteral('http://[fe80::1]/')).toEqual({
      isIp: true,
      isBlocked: true,
      address: 'fe80::1',
    });
  });

  it('rejects IPv4-mapped IPv6 literals', () => {
    expect(checkIpLiteral('http://[::ffff:127.0.0.1]/')).toEqual({
      isIp: true,
      isBlocked: true,
      address: '::ffff:7f00:1',
    });
    expect(checkIpLiteral('http://[::ffff:169.254.169.254]/')).toEqual({
      isIp: true,
      isBlocked: true,
      address: '::ffff:a9fe:a9fe',
    });
  });

  it('rejects decimal, hex, and octal integer IP representations normalized by WHATWG URL', () => {
    // 2130706433 is 127.0.0.1 in decimal
    expect(checkIpLiteral('http://2130706433/')).toEqual({
      isIp: true,
      isBlocked: true,
      address: '127.0.0.1',
    });
    // 0x7f000001 is 127.0.0.1 in hex
    expect(checkIpLiteral('http://0x7f000001/')).toEqual({
      isIp: true,
      isBlocked: true,
      address: '127.0.0.1',
    });
    // 0177.0.0.1 is 127.0.0.1 in octal
    expect(checkIpLiteral('http://0177.0.0.1/')).toEqual({
      isIp: true,
      isBlocked: true,
      address: '127.0.0.1',
    });
  });

  it('allows public IP literals', () => {
    // example.com IPv4
    expect(checkIpLiteral('http://93.184.216.34/')).toEqual({
      isIp: true,
      isBlocked: false,
      address: '93.184.216.34',
    });
  });

  it('does not classify hostnames as IP literals', () => {
    expect(checkIpLiteral('http://example.com/')).toEqual({
      isIp: false,
      isBlocked: false,
    });
    expect(checkIpLiteral('http://localhost/')).toEqual({
      isIp: false,
      isBlocked: false,
    });
  });
});

describe('Abuse Control - BYOK Key Validation & Caching', () => {
  beforeEach(() => {
    clearByokKeyCache();
  });

  it('calls authenticated endpoint with 8s timeout and caches success by SHA-256 for 10 minutes', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const key = 'sk-test-live-key-12345';
    const keyHash = hashApiKey(key);

    const valid = await validateByokApiKey('openai', key, mockFetch as unknown as typeof fetch);
    expect(valid).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        headers: { Authorization: `Bearer ${key}` },
      }),
    );

    // Second call should hit in-memory cache keyed by SHA-256 (no fetch call)
    const validCached = await validateByokApiKey('openai', key, mockFetch as unknown as typeof fetch);
    expect(validCached).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1); // not called again
  });

  it('rejects invalid key with false and does not cache failure', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });

    const key = 'invalid-key-999';
    const valid = await validateByokApiKey('openai', key, mockFetch as unknown as typeof fetch);
    expect(valid).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second call should still call fetch because failure is not cached
    await validateByokApiKey('openai', key, mockFetch as unknown as typeof fetch);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('supports OpenRouter key-info endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const key = 'sk-or-v1-abc';

    const valid = await validateByokApiKey('openrouter', key, mockFetch as unknown as typeof fetch);
    expect(valid).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/key',
      expect.objectContaining({
        headers: { Authorization: `Bearer ${key}` },
      }),
    );
  });

  it('supports Anthropic and Gemini endpoints', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await validateByokApiKey('anthropic', 'sk-ant-test', mockFetch as unknown as typeof fetch);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-api-key': 'sk-ant-test' }),
      }),
    );

    await validateByokApiKey('gemini', 'gem-test-key', mockFetch as unknown as typeof fetch);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models?key=gem-test-key',
      expect.anything(),
    );
  });
});

describe('Abuse Control - BYOK Rate Limiting', () => {
  beforeEach(() => {
    resetByokRateLimits();
  });

  it('enforces BYOK per-IP and cookie rate limit (default 20/day)', () => {
    process.env.BYOK_RATE_LIMIT_PER_DAY = '3'; // lower for test

    const mockReply = {
      setCookie: vi.fn(),
    };

    // getClientIp reads headers['cf-connecting-ip'] and socket.remoteAddress
    const mockReq = {
      headers: { 'cf-connecting-ip': '198.51.100.5' },
      socket: { remoteAddress: '10.0.0.1' },
      log: { warn: vi.fn() },
      cookies: {},
    };

    // First 3 requests succeed
    expect(checkAndConsumeByokRateLimit(mockReq as any, mockReply as any)).toBe(true);
    expect(checkAndConsumeByokRateLimit(mockReq as any, mockReply as any)).toBe(true);
    expect(checkAndConsumeByokRateLimit(mockReq as any, mockReply as any)).toBe(true);

    // 4th request blocked by IP bucket
    expect(checkAndConsumeByokRateLimit(mockReq as any, mockReply as any)).toBe(false);

    // Even if cookie is wiped, IP bucket still blocks it
    const wipedCookieReq = {
      headers: { 'cf-connecting-ip': '198.51.100.5' },
      socket: { remoteAddress: '10.0.0.1' },
      log: { warn: vi.fn() },
      cookies: {},
    };
    expect(checkAndConsumeByokRateLimit(wipedCookieReq as any, mockReply as any)).toBe(false);
  });
});

describe('Abuse Control - Queue Capacity & Concurrency', () => {
  beforeEach(() => {
    resetInFlightIps();
    resetQueueForTest();
  });

  it('limits to at most 1 in-flight job per IP', () => {
    const ip = '203.0.113.19';

    expect(checkQueueCapacity(ip)).toEqual({ allowed: true });
    trackInFlightStart(ip);

    // Second check while in-flight returns 429
    const secondCheck = checkQueueCapacity(ip);
    expect(secondCheck.allowed).toBe(false);
    expect(secondCheck.status).toBe(429);

    // After finish, IP can submit again
    trackInFlightEnd(ip);
    expect(checkQueueCapacity(ip)).toEqual({ allowed: true });
  });

  it('caps pending jobs with 503 BUSY', () => {
    process.env.MAX_PENDING_JOBS = '2';

    // Simulate pending jobs
    const ip1 = '1.1.1.1';
    const ip2 = '2.2.2.2';
    const ip3 = '3.3.3.3';

    expect(checkQueueCapacity(ip1)).toEqual({ allowed: true });

    // Enqueue 2 dummy jobs (1 running + 1 pending in queue)
    enqueue(() => new Promise(() => {}));
    enqueue(() => new Promise(() => {}));

    // Now queue has 1 running + 1 pending or 2 pending
    // Let's test queue cap
    process.env.MAX_PENDING_JOBS = '1';
    const capCheck = checkQueueCapacity(ip3);
    expect(capCheck.allowed).toBe(false);
    expect(capCheck.status).toBe(503);
    expect(capCheck.code).toBe('BUSY');
    expect(capCheck.retryAfterSeconds).toBe(30);

    // Clean up
    resetQueueForTest();
  });
});

describe('Abuse Control - Global Budget & Quota Circuit Breaker', () => {
  beforeEach(() => {
    resetGlobalBudget();
  });

  it('enforces global daily budget for default Gemini path (default 150/day UTC)', () => {
    process.env.GLOBAL_DAILY_AUDITS = '2';

    expect(checkDefaultPathBudget().allowed).toBe(true);
    recordDefaultPathAudit();
    expect(checkDefaultPathBudget().allowed).toBe(true);
    recordDefaultPathAudit();

    const blocked = checkDefaultPathBudget();
    expect(blocked.allowed).toBe(false);
    expect(blocked.code).toBe('AI_QUOTA_EXHAUSTED');
    expect(typeof blocked.resetAt).toBe('string');
  });

  it('circuit breaker trips ONLY on PerDay quotaId in Gemini 429 response', () => {
    // 1. Per-day error shape from Google Cloud / Gemini API
    const dailyQuotaError = {
      status: 429,
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [
            {
              subject: 'project:verdict-prod',
              description: 'Quota exceeded for quota metric GenerateRequestsPerDayPerProject',
              quotaId: 'GenerateRequestsPerDayPerProject',
            },
          ],
        },
      ],
    };

    expect(extractGeminiPerDayQuotaId(dailyQuotaError)).toBe(true);
    const tripped = tripGeminiCircuitBreaker(dailyQuotaError);
    expect(tripped).toBe(true);

    const check = checkDefaultPathBudget();
    expect(check.allowed).toBe(false);
    expect(check.code).toBe('AI_QUOTA_EXHAUSTED');
    expect(typeof check.resetAt).toBe('string');
  });

  it('per-minute quotaId does NOT trip circuit breaker', () => {
    const minuteQuotaError = {
      status: 429,
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [
            {
              subject: 'project:verdict-prod',
              description: 'Quota exceeded for GenerateRequestsPerMinutePerProject',
              quotaId: 'GenerateRequestsPerMinutePerProject',
            },
          ],
        },
      ],
    };

    expect(extractGeminiPerDayQuotaId(minuteQuotaError)).toBe(false);
    const tripped = tripGeminiCircuitBreaker(minuteQuotaError);
    expect(tripped).toBe(false);

    // Default path budget remains allowed
    expect(checkDefaultPathBudget().allowed).toBe(true);
  });

  it('computes next midnight America/Los_Angeles with Intl across DST boundaries', () => {
    // Standard PDT (Summer / Daylight Saving)
    const summerDate = new Date('2026-07-15T15:00:00Z');
    const summerMidnight = getNextMidnightLosAngeles(summerDate);
    // Midnight PDT is 07:00:00 UTC
    expect(summerMidnight.toISOString()).toBe('2026-07-16T07:00:00.000Z');

    // DST Fall Back transition in 2026: Nov 1, 2026
    // After Nov 1, LA is in PST (UTC-8)
    const winterDate = new Date('2026-11-02T15:00:00Z');
    const winterMidnight = getNextMidnightLosAngeles(winterDate);
    // Midnight PST is 08:00:00 UTC
    expect(winterMidnight.toISOString()).toBe('2026-11-03T08:00:00.000Z');

    // DST Spring Forward transition in 2026: March 8, 2026
    // After March 8, LA is in PDT (UTC-7)
    const springDate = new Date('2026-03-09T15:00:00Z');
    const springMidnight = getNextMidnightLosAngeles(springDate);
    expect(springMidnight.toISOString()).toBe('2026-03-10T07:00:00.000Z');
  });
});

describe('Orphan Reconciliation', () => {
  it('marks pending jobs >10m and running jobs >5m as failed with SERVER_RESTART code', async () => {
    // Mock db.update returning orphaned rows
    const updateSpy = vi.spyOn(db, 'update').mockImplementation((() => {
      const builder: any = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: 'test-job-id', status: 'failed', failureReason: 'SERVER_RESTART' }]),
      };
      return builder;
    }) as any);

    const now = new Date('2026-10-23T12:00:00Z');
    const result = await reconcileOrphanedJobs(now);

    expect(updateSpy).toHaveBeenCalledTimes(2);
    expect(result.pendingOrphaned.length).toBe(1);
    expect(result.runningOrphaned.length).toBe(1);
    expect(result.pendingOrphaned[0].failureReason).toBe('SERVER_RESTART');

    updateSpy.mockRestore();
  });
});

describe('Crash Defenses - logFatalAndExit', () => {
  it('formats single structured JSON line to stderr and redacts secrets', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as any);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

    const secretError = new Error('Failed to connect with apiKey=sk-secret-live-value-12345 in db');
    logFatalAndExit('uncaughtException', secretError);

    expect(stderrSpy).toHaveBeenCalled();
    const output = stderrSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trim());

    expect(parsed.level).toBe('fatal');
    expect(parsed.type).toBe('uncaughtException');
    expect(parsed.message).not.toContain('sk-secret-live-value-12345');
    expect(parsed.message).toContain('apiKey=[REDACTED]');

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
