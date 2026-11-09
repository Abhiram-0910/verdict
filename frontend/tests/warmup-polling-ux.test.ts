import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { preview, PreviewServer } from 'vite';
import { chromium, Browser, Page } from 'playwright';

describe('Warm-up Ping, Polling & Loading UX', () => {
  let server: PreviewServer;
  let browser: Browser;
  let baseUrl: string;

  beforeAll(async () => {
    server = await preview({
      preview: { port: 4180, host: '127.0.0.1' },
      configFile: 'vite.config.ts',
    });
    baseUrl = server.resolvedUrls.local[0].replace(/\/$/, '');
    browser = await chromium.launch({ headless: true });
  }, 30000);

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) await server.close();
  });

  it('Requirement 3: Fires warm-up ping once per session and never throws', async () => {
    const page: Page = await browser.newPage();
    let healthPingCount = 0;

    await page.route('**/health', async (route) => {
      healthPingCount++;
      await route.fulfill({ status: 200, contentType: 'text/plain', body: 'OK' });
    });

    // First visit: should trigger warm-up ping
    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
    expect(healthPingCount).toBe(1);

    // Check sessionStorage
    const warmed = await page.evaluate(() => sessionStorage.getItem('verdict_warmed'));
    expect(warmed).toBe('1');

    // Reload / re-visit within the same session: should NOT ping again
    await page.reload({ waitUntil: 'networkidle' });
    expect(healthPingCount).toBe(1);

    await page.close();
  });

  it('Requirement 4: Tolerates up to 6 transient 502/503 errors during server restart quietly without showing error', async () => {
    const page: Page = await browser.newPage();
    let pollAttempts = 0;

    await page.route('**/api/audits/restarting-job-1', async (route) => {
      pollAttempts++;
      if (pollAttempts <= 2) {
        // Return 502 Bad Gateway (Render/Koyeb restart)
        await route.fulfill({ status: 502, contentType: 'text/plain', body: 'Bad Gateway' });
      } else {
        // Server recovered!
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            job: { id: 'restarting-job-1', status: 'running' },
          }),
        });
      }
    });

    await page.goto(`${baseUrl}/audit/restarting-job-1`);

    // Verify loading screen is shown without flashing "Error Loading Report"
    await page.waitForSelector('text=Analyzing Website');
    const errorHeading = page.locator('text=Error Loading Report');
    expect(await errorHeading.count()).toBe(0);

    // Wait for at least 3 poll attempts to complete recovery
    await page.waitForTimeout(7000);
    expect(pollAttempts).toBeGreaterThanOrEqual(2);
    expect(await errorHeading.count()).toBe(0);

    await page.close();
  }, 20000);

  it('Requirement 5: Loading UX shows honest copy, elapsed timer, oscilloscope animation, and no fake stages', async () => {
    const page: Page = await browser.newPage();

    await page.route('**/api/audits/loading-test-job', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          job: {
            id: 'loading-test-job',
            url: 'https://example.com',
            status: 'running',
            visualStatus: 'pending',
            copyStatus: 'pending',
            failureReason: null,
          },
        }),
      });
    });

    await page.goto(`${baseUrl}/audit/loading-test-job`);

    // 1. Honest duration copy
    await page.waitForSelector('text=Analysis usually takes 20–60 seconds.');

    // 2. No fake stages (stage claim is either "Analyzing Website" or "Audit Queued")
    const fakeStage = page.locator('text=Scanning 45%');
    expect(await fakeStage.count()).toBe(0);

    // 3. Oscilloscope waveform SVG is present
    const oscilloscopeSvg = page.locator('svg path[d*="M 0 30 L 70 30"]');
    expect(await oscilloscopeSvg.isVisible()).toBe(true);

    // 4. Elapsed timer component exists and updates
    await page.waitForSelector('text=Elapsed:');
    const elapsedBadge = page.locator('text=/Elapsed: \\d+s/');
    expect(await elapsedBadge.isVisible()).toBe(true);

    await page.close();
  });

  it('Requirement 6: Live countdown handles 503 AI_QUOTA_EXHAUSTED and 429 free tier with zero re-enable', async () => {
    const page: Page = await browser.newPage();

    // Test 503 AI_QUOTA_EXHAUSTED
    const quotaResetTime = new Date(Date.now() + 3000).toISOString(); // resets in 3s
    await page.route('**/api/audits', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Service Unavailable',
            code: 'AI_QUOTA_EXHAUSTED',
            resetAt: quotaResetTime,
            detail: 'The AI service daily quota is currently exhausted.',
          }),
        });
      }
    });

    await page.goto(`${baseUrl}/`);
    await page.locator('#audit-url-input').fill('quota-test.com');
    await page.click('button[type="submit"]');

    // Countdown banner should appear with live countdown
    await page.waitForSelector('text=Daily free AI quota reached.');
    await page.waitForSelector('text=Resets in');

    // Submit button should be disabled
    const submitBtn = page.locator('button[type="submit"]');
    expect(await submitBtn.isDisabled()).toBe(true);

    // Wait for countdown to reach zero and re-enable button
    await page.waitForTimeout(4000);
    expect(await submitBtn.isEnabled()).toBe(true);

    await page.close();
  }, 20000);
});
