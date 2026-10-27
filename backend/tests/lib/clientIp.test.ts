/**
 * clientIp.test.ts
 *
 * Tests for getClientIp() in lib/clientIp.ts.
 *
 * Key invariants verified:
 *  1. Forged X-Forwarded-For is completely ignored — resolved IP comes from
 *     cf-connecting-ip (if valid) or the socket peer.
 *  2. A valid public cf-connecting-ip is used as the canonical IP.
 *  3. Private/invalid/multi-value cf-connecting-ip falls back to socket peer.
 *  4. The rate limiter treats two different cf-connecting-ip values as different
 *     clients, and two requests with the same cf-connecting-ip but different
 *     forged X-Forwarded-For headers as the same client.
 *  5. Lint: request.ip / request.ips / req.ip / req.ips do not appear in any
 *     backend/src .ts file other than clientIp.ts itself (functional use).
 *  6. bodyLimit: oversized request bodies are rejected with HTTP 413.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getClientIp,
  resetWarnThrottleForTest,
} from '../../src/lib/clientIp.js';
import {
  checkAndConsumeRateLimit,
  resetIpUsageForTest,
} from '../../src/lib/rateLimit.js';
import { buildServer } from '../../src/server.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(opts: {
  cfConnectingIp?: string | string[];
  xForwardedFor?: string;
  socketIp?: string;
}) {
  const headers: Record<string, string | string[]> = {};
  if (opts.cfConnectingIp !== undefined) {
    headers['cf-connecting-ip'] = opts.cfConnectingIp;
  }
  if (opts.xForwardedFor !== undefined) {
    headers['x-forwarded-for'] = opts.xForwardedFor;
  }
  return {
    headers,
    socket: { remoteAddress: opts.socketIp ?? '10.0.0.2' },
    log: { warn: () => {} },
    cookies: {},
  } as any;
}

// ---------------------------------------------------------------------------
// 1. getClientIp unit tests
// ---------------------------------------------------------------------------

describe('getClientIp - cf-connecting-ip resolution', () => {
  beforeEach(() => {
    resetWarnThrottleForTest();
  });

  it('returns cf-connecting-ip when it is a valid public IPv4', () => {
    const req = makeReq({ cfConnectingIp: '203.0.113.1' });
    const result = getClientIp(req);
    expect(result.ip).toBe('203.0.113.1');
    expect(result.source).toBe('cf-connecting-ip');
  });

  it('returns cf-connecting-ip when it is a valid public IPv6', () => {
    const req = makeReq({ cfConnectingIp: '2001:db8::1' });
    const result = getClientIp(req);
    expect(result.ip).toBe('2001:db8::1');
    expect(result.source).toBe('cf-connecting-ip');
  });

  it('forged X-Forwarded-For is completely ignored — uses cf-connecting-ip instead', () => {
    // Attacker sends a spoofed XFF but a valid CF header is present.
    const req = makeReq({
      cfConnectingIp: '203.0.113.42',
      xForwardedFor: '1.2.3.4',
      socketIp: '10.0.0.2',
    });
    const result = getClientIp(req);
    // Must resolve to the CF header value, not the forged XFF or socket
    expect(result.ip).toBe('203.0.113.42');
    expect(result.source).toBe('cf-connecting-ip');
  });

  it('forged X-Forwarded-For with no cf-connecting-ip falls back to socket (not XFF)', () => {
    // Attacker forges XFF without a CF header — must fall back to socket, not XFF
    const req = makeReq({
      xForwardedFor: '1.2.3.4',
      socketIp: '10.99.0.1',
    });
    const result = getClientIp(req);
    expect(result.ip).toBe('10.99.0.1');
    expect(result.source).toBe('socket');
  });

  it('falls back to socket when cf-connecting-ip is absent', () => {
    const req = makeReq({ socketIp: '172.31.0.5' });
    const result = getClientIp(req);
    expect(result.ip).toBe('172.31.0.5');
    expect(result.source).toBe('socket');
  });

  it('falls back to socket when cf-connecting-ip is an invalid string', () => {
    const req = makeReq({ cfConnectingIp: 'not-an-ip', socketIp: '10.0.0.3' });
    const result = getClientIp(req);
    expect(result.ip).toBe('10.0.0.3');
    expect(result.source).toBe('socket');
  });

  it('falls back to socket when cf-connecting-ip contains multiple values (comma-separated)', () => {
    const req = makeReq({ cfConnectingIp: '203.0.113.1, 198.51.100.1', socketIp: '10.0.0.4' });
    const result = getClientIp(req);
    expect(result.ip).toBe('10.0.0.4');
    expect(result.source).toBe('socket');
  });

  it('falls back to socket when cf-connecting-ip is supplied as an array header', () => {
    const req = makeReq({ cfConnectingIp: ['203.0.113.1', '198.51.100.1'], socketIp: '10.0.0.5' });
    const result = getClientIp(req);
    expect(result.ip).toBe('10.0.0.5');
    expect(result.source).toBe('socket');
  });

  it('falls back to socket when cf-connecting-ip is a private RFC1918 address', () => {
    const req = makeReq({ cfConnectingIp: '192.168.1.1', socketIp: '10.0.0.6' });
    const result = getClientIp(req);
    expect(result.ip).toBe('10.0.0.6');
    expect(result.source).toBe('socket');
  });

  it('falls back to socket when cf-connecting-ip is loopback (127.0.0.1)', () => {
    const req = makeReq({ cfConnectingIp: '127.0.0.1', socketIp: '10.0.0.7' });
    const result = getClientIp(req);
    expect(result.ip).toBe('10.0.0.7');
    expect(result.source).toBe('socket');
  });

  it('falls back to socket when cf-connecting-ip is CGNAT (100.64.x.x)', () => {
    const req = makeReq({ cfConnectingIp: '100.64.0.1', socketIp: '10.0.0.8' });
    const result = getClientIp(req);
    expect(result.ip).toBe('10.0.0.8');
    expect(result.source).toBe('socket');
  });

  it('falls back to socket when cf-connecting-ip is IPv6 loopback (::1)', () => {
    const req = makeReq({ cfConnectingIp: '::1', socketIp: '10.0.0.9' });
    const result = getClientIp(req);
    expect(result.ip).toBe('10.0.0.9');
    expect(result.source).toBe('socket');
  });
});

// ---------------------------------------------------------------------------
// 2. Rate limiter identity tests (two different cf IPs = different buckets;
//    same cf IP with different forged XFF = same bucket)
// ---------------------------------------------------------------------------

describe('getClientIp - rate limiter identity', () => {
  beforeEach(() => {
    resetWarnThrottleForTest();
    resetIpUsageForTest();
    process.env.RATE_LIMIT_FREE_AUDITS_PER_DAY = '2';
  });

  it('two different cf-connecting-ip values are treated as different clients', () => {
    const reply = { setCookie: () => {} } as any;

    const reqA = makeReq({ cfConnectingIp: '203.0.113.10' });
    const reqB = makeReq({ cfConnectingIp: '203.0.113.11' });

    // Each client gets their own bucket — first calls for both succeed
    expect(checkAndConsumeRateLimit(reqA, reply)).toBe(true);
    expect(checkAndConsumeRateLimit(reqB, reply)).toBe(true);

    // Second call for each also succeeds (limit = 2)
    expect(checkAndConsumeRateLimit(reqA, reply)).toBe(true);
    expect(checkAndConsumeRateLimit(reqB, reply)).toBe(true);

    // Third call for each is blocked (limit = 2 exhausted)
    expect(checkAndConsumeRateLimit(reqA, reply)).toBe(false);
    expect(checkAndConsumeRateLimit(reqB, reply)).toBe(false);
  });

  it('same cf-connecting-ip with different forged X-Forwarded-For values counts as ONE client', () => {
    const reply = { setCookie: () => {} } as any;

    // Two "requests" that look like different XFF origins but same real user
    const req1 = makeReq({ cfConnectingIp: '203.0.113.20', xForwardedFor: '1.2.3.4' });
    const req2 = makeReq({ cfConnectingIp: '203.0.113.20', xForwardedFor: '9.9.9.9' });

    // Both consume from the same IP bucket (203.0.113.20)
    expect(checkAndConsumeRateLimit(req1, reply)).toBe(true);  // count = 1
    expect(checkAndConsumeRateLimit(req2, reply)).toBe(true);  // count = 2 (limit reached)

    // Third request — any variant — should be blocked
    const req3 = makeReq({ cfConnectingIp: '203.0.113.20', xForwardedFor: '5.5.5.5' });
    expect(checkAndConsumeRateLimit(req3, reply)).toBe(false); // blocked
  });
});

// ---------------------------------------------------------------------------
// 3. Lint test: request.ip / request.ips / req.ip / req.ips must not appear
//    in any backend/src file outside of clientIp.ts (functional use in code,
//    not just in comments).
// ---------------------------------------------------------------------------

describe('Lint: no request.ip / req.ip in backend/src outside clientIp.ts', () => {
  it('finds zero functional occurrences of request.ip or req.ip outside clientIp.ts', () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const srcRoot = path.resolve(__dirname, '../../src');

    // Recursively collect all .ts files except clientIp.ts
    function collectTs(dir: string): string[] {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          files.push(...collectTs(full));
        } else if (e.isFile() && e.name.endsWith('.ts') && e.name !== 'clientIp.ts') {
          files.push(full);
        }
      }
      return files;
    }

    const pattern = /\b(?:request|req)\.ip(?:s)?\b/g;
    // A match is "functional" if it is NOT inside a // comment on that line
    const violations: string[] = [];

    for (const file of collectTs(srcRoot)) {
      const lines = fs.readFileSync(file, 'utf-8').split('\n');
      lines.forEach((line, idx) => {
        // Strip inline comments
        const codeOnly = line.replace(/\/\/.*$/, '');
        if (pattern.test(codeOnly)) {
          violations.push(`${file}:${idx + 1}: ${line.trim()}`);
        }
        pattern.lastIndex = 0; // reset stateful regex
      });
    }

    if (violations.length > 0) {
      throw new Error(
        `request.ip / req.ip found outside clientIp.ts (${violations.length} violation(s)):\n` +
          violations.map((v) => `  ${v}`).join('\n'),
      );
    }
    expect(violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. bodyLimit: oversized POST bodies are rejected with 413
// ---------------------------------------------------------------------------

describe('Server bodyLimit', () => {
  it('rejects a POST body larger than 32768 bytes with HTTP 413', async () => {
    const app = await buildServer();

    // Build a body just over the 32 KiB limit (32769 bytes)
    const oversizedBody = JSON.stringify({ url: 'https://example.com', padding: 'x'.repeat(32769) });

    const response = await app.inject({
      method: 'POST',
      url: '/api/audits',
      headers: { 'content-type': 'application/json' },
      body: oversizedBody,
    });

    expect(response.statusCode).toBe(413);
    await app.close();
  });

  it('accepts a normal-sized POST body without error', async () => {
    const app = await buildServer();

    const normalBody = JSON.stringify({ url: 'https://example.com' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/audits',
      headers: { 'content-type': 'application/json' },
      body: normalBody,
    });

    // Any non-413 response means the body was accepted (could be 202, 429, 400, etc.)
    expect(response.statusCode).not.toBe(413);
    await app.close();
  });
});
