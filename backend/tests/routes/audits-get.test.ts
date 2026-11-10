/**
 * tests/routes/audits-get.test.ts
 *
 * Verifies that GET /api/audits/:id drops renderedText from the response
 * captureResult (item 5).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../../src/server.js';
import { db } from '../../src/db/index.js';

describe('GET /api/audits/:id — renderedText exclusion', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  const testJobId = '11111111-1111-4111-a111-111111111111';

  beforeEach(async () => {
    app = await buildServer();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('excludes renderedText from captureResult in GET /api/audits/:id', async () => {
    // Mock db.select queries for auditJob, captureResult, etc.
    const mockJob = {
      id: testJobId,
      url: 'https://example.com',
      status: 'complete',
      failureReason: null,
      createdAt: new Date(),
    };

    const mockCapture = {
      id: '22222222-2222-4222-a222-222222222222',
      auditJobId: testJobId,
      desktopScreenshotUrl: 'https://example.com/desktop.png',
      mobileScreenshotUrl: 'https://example.com/mobile.png',
      renderedText: 'Internal untrusted page text that must not be leaked',
      loadTimeMs: 120,
      lcp: 500,
      cls: '0.0100',
      partial: false,
      partialReason: null,
      createdAt: new Date(),
    };

    let selectCallCount = 0;
    vi.spyOn(db, 'select').mockImplementation(() => {
      selectCallCount++;
      const currentCall = selectCallCount;
      return {
        from: () => ({
          where: () => {
            if (currentCall === 1) return Promise.resolve([mockJob]);
            if (currentCall === 2) return Promise.resolve([mockCapture]);
            return Promise.resolve([]);
          },
        }),
      } as any;
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/audits/${testJobId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.job).toBeDefined();
    expect(body.captureResult).toBeDefined();
    expect(body.captureResult.desktopScreenshotUrl).toBe('https://example.com/desktop.png');
    // Ensure renderedText is NOT present in the returned JSON
    expect(body.captureResult).not.toHaveProperty('renderedText');
    expect(body.captureResult.renderedText).toBeUndefined();
  });
});
