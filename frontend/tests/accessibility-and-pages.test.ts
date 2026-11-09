import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { preview, PreviewServer } from 'vite';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

describe('Accessibility (axe-core) & Privacy/Terms Pages', () => {
  let server: PreviewServer;
  let browser: Browser;
  let baseUrl: string;

  beforeAll(async () => {
    server = await preview({
      preview: { port: 4181, host: '127.0.0.1' },
      configFile: 'vite.config.ts',
    });
    baseUrl = server.resolvedUrls.local[0].replace(/\/$/, '');
    browser = await chromium.launch({ headless: true });
  }, 30000);

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) await server.close();
  });

  it('Requirement 8: Privacy and Terms pages exist, are linked in footer, and state all required points', async () => {
    const context: BrowserContext = await browser.newContext();
    const page: Page = await context.newPage();

    // Check footer on landing
    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
    const privacyLink = page.locator('footer a[href="/privacy"]');
    const termsLink = page.locator('footer a[href="/terms"]');
    expect(await privacyLink.isVisible()).toBe(true);
    expect(await termsLink.isVisible()).toBe(true);

    // Visit /privacy
    await privacyLink.click();
    await page.waitForURL('**/privacy');
    await page.waitForSelector('h1:has-text("Privacy Policy")');

    const privacyText = await page.innerText('main');
    expect(privacyText).toContain('Audited URL');
    expect(privacyText).toContain('Screenshots');
    expect(privacyText).toContain('verdict_usage');
    expect(privacyText).toContain('verdict_byok_usage');
    expect(privacyText).toContain('30 days');
    expect(privacyText).toContain('IP addresses');
    expect(privacyText).toContain('No accounts');
    expect(privacyText).toContain('Gemini API under the free tier');
    expect(privacyText).toContain('EEA');
    expect(privacyText).toContain('Bring Your Own Key');
    expect(privacyText).toContain('never stored');
    expect(privacyText).toContain('Deletion on request');
    expect(privacyText).toContain('Do not include the audited URL or personal details in a public issue; ask for a private contact channel.');

    // Visit /terms
    await page.goto(`${baseUrl}/terms`, { waitUntil: 'networkidle' });
    await page.waitForSelector('h1:has-text("Terms of Service")');
    const termsText = await page.innerText('main');
    expect(termsText).toContain('Terms of Service');
    expect(termsText).toContain('automated diagnostic');
    expect(termsText).toContain('private, internal, or loopback');
    expect(termsText).toContain('Free Tier');

    await context.close();
  });

  it('Requirement 9: axe-core passes with 0 serious/critical violations on Landing page', async () => {
    const context: BrowserContext = await browser.newContext();
    const page: Page = await context.newPage();
    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });

    const results = await new AxeBuilder({ page }).analyze();
    const severeViolations = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    );
    expect(severeViolations).toEqual([]);
    await context.close();
  });

  it('Requirement 9: axe-core passes with 0 serious/critical violations with BYOK panel open', async () => {
    const context: BrowserContext = await browser.newContext();
    const page: Page = await context.newPage();
    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });

    // Open BYOK panel
    await page.click('text=Use your own API key');
    await page.waitForSelector('#byok-provider');

    const results = await new AxeBuilder({ page }).analyze();
    const severeViolations = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    );
    expect(severeViolations).toEqual([]);

    // Check computed colors of BYOK inputs and select elements: no white-on-white
    const apiKeyInput = page.locator('#byok-api-key');
    const inputColor = await apiKeyInput.evaluate((el) => window.getComputedStyle(el).color);
    const inputBg = await apiKeyInput.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    
    // Ensure text color is dark ink (not white / transparent)
    expect(inputColor).not.toBe('rgb(255, 255, 255)');
    expect(inputColor).not.toBe('rgba(0, 0, 0, 0)');
    // Background should not match foreground
    expect(inputColor).not.toBe(inputBg);

    // Check provider select
    const providerSelect = page.locator('#byok-provider');
    const selectColor = await providerSelect.evaluate((el) => window.getComputedStyle(el).color);
    const selectBg = await providerSelect.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    expect(selectColor).not.toBe('rgb(255, 255, 255)');
    expect(selectColor).not.toBe(selectBg);

    // Check option elements
    const optionEl = page.locator('#byok-provider option').first();
    const optColor = await optionEl.evaluate((el) => window.getComputedStyle(el).color);
    expect(optColor).not.toBe('rgba(0, 0, 0, 0)');

    await context.close();
  });

  it('Requirement 9: axe-core passes with 0 serious/critical violations on Report page', async () => {
    const context: BrowserContext = await browser.newContext();
    const page: Page = await context.newPage();

    // Mock completed report data
    await page.route('**/api/audits/axe-report-test', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          job: {
            id: 'axe-report-test',
            url: 'https://example.com',
            status: 'complete',
            visualStatus: 'complete',
            copyStatus: 'complete',
            failureReason: null,
          },
          captureResult: {
            id: 'cap-1',
            desktopScreenshotUrl: 'https://shsouuvbiyoqcfdmcoxs.supabase.co/storage/v1/object/public/verdict-screenshots/desktop.png',
            mobileScreenshotUrl: '',
            loadTimeMs: 400,
            lcp: 1.0,
            cls: '0',
          },
          auditScore: {
            overall: 92,
            breakdown: { visual: 90, copy: 94, accessibility: 95, performance: 88 },
          },
          actionItems: [
            {
              id: 'item-1',
              rank: 1,
              title: 'Add alternative text',
              description: 'Primary hero image is missing alt attribute.',
              estimatedImpact: 'high',
              findingType: 'accessibility',
              findingId: 'acc-1',
            },
          ],
          visualFindings: [],
        }),
      });
    });

    await page.route('https://*.supabase.co/**', async (route) => {
      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        'base64'
      );
      await route.fulfill({ status: 200, contentType: 'image/png', body: pngBuffer });
    });

    await page.goto(`${baseUrl}/audit/axe-report-test`, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=Audit Report');

    const results = await new AxeBuilder({ page }).analyze();
    const severeViolations = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    );
    expect(severeViolations).toEqual([]);
    await context.close();
  });

  it('Requirement 9: axe-core passes with 0 serious/critical violations on 404 page', async () => {
    const context: BrowserContext = await browser.newContext();
    const page: Page = await context.newPage();
    await page.goto(`${baseUrl}/some-non-existent-route-404`, { waitUntil: 'networkidle' });
    await page.waitForSelector('h1:has-text("Page Not Found")');

    const results = await new AxeBuilder({ page }).analyze();
    const severeViolations = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    );
    expect(severeViolations).toEqual([]);
    await context.close();
  });
});
