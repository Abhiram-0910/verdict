import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { preview, PreviewServer } from 'vite';
import { chromium, Browser, Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

describe('Security Headers, CSP & Mocked Audit Flow (Vite Preview)', () => {
  let server: PreviewServer;
  let browser: Browser;
  let baseUrl: string;

  beforeAll(async () => {
    // Start preview server on port 4182
    server = await preview({
      preview: { port: 4182, host: '127.0.0.1' },
      configFile: 'vite.config.ts',
    });
    baseUrl = server.resolvedUrls.local[0].replace(/\/$/, '');
    browser = await chromium.launch({ headless: true });
  }, 30000);

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) await server.close();
  });

  it('enforces committed production CSP in vercel.json with Render origin, no local addresses, and no unsafe script directives', () => {
    const vercelJsonPath = path.resolve(__dirname, '../vercel.json');
    const vercelConfig = JSON.parse(fs.readFileSync(vercelJsonPath, 'utf8'));
    const headers = vercelConfig.headers?.[0]?.headers || [];
    const cspHeader = headers.find((h: { key: string }) => h.key === 'Content-Security-Policy');
    expect(cspHeader).toBeDefined();
    const cspValue = cspHeader.value;

    const connectSrcMatch = cspValue.match(/connect-src\s+([^;]+)/);
    expect(connectSrcMatch).toBeTruthy();
    const connectSrc = connectSrcMatch ? connectSrcMatch[1] : '';

    expect(connectSrc).toContain('https://verdict-backend-m2co.onrender.com');
    expect(connectSrc).not.toContain('127.0.0.1');
    expect(connectSrc).not.toContain('localhost');

    const scriptSrcMatch = cspValue.match(/script-src\s+([^;]+)/);
    expect(scriptSrcMatch).toBeTruthy();
    const scriptSrc = scriptSrcMatch ? scriptSrcMatch[1] : '';

    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it('serves required security headers on index.html', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.ok).toBe(true);

    const headers = res.headers;
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=()');

    const csp = headers.get('content-security-policy');
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("img-src 'self' data: https://*.supabase.co");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('completes mocked audit flow without any console CSP violations', async () => {
    const page: Page = await browser.newPage();
    const cspErrors: string[] = [];
    const consoleErrors: string[] = [];

    // Capture console CSP warnings or errors
    page.on('console', (msg) => {
      const text = msg.text();
      if (/violates the following Content Security Policy directive/i.test(text) || /Content Security Policy/i.test(text)) {
        cspErrors.push(text);
      }
      if (msg.type() === 'error') {
        consoleErrors.push(text);
      }
    });

    page.on('pageerror', (err) => {
      consoleErrors.push(err.message);
    });

    // Also listen directly to the standard SecurityPolicyViolationEvent in the DOM
    await page.exposeFunction('onCspViolation', (directive: string, blockedURI: string) => {
      cspErrors.push(`CSP violation: directive=${directive}, blockedURI=${blockedURI}`);
    });

    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        (window as any).onCspViolation(e.violatedDirective, e.blockedURI);
      });
    });

    // Mock API endpoints
    await page.route('**/health', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });

    await page.route('**/api/audits', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 202,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'test-csp-audit-123' }),
        });
      } else {
        await route.continue();
      }
    });

    let pollCount = 0;
    await page.route('**/api/audits/test-csp-audit-123', async (route) => {
      pollCount++;
      if (pollCount === 1) {
        // Return running status
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            job: {
              id: 'test-csp-audit-123',
              url: 'https://example.com',
              status: 'running',
              visualStatus: 'pending',
              copyStatus: 'pending',
              failureReason: null,
            },
          }),
        });
      } else {
        // Return completed report
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            job: {
              id: 'test-csp-audit-123',
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
              loadTimeMs: 450,
              lcp: 1.2,
              cls: '0.01',
            },
            auditScore: {
              overall: 84,
              breakdown: { visual: 85, copy: 80, accessibility: 90, performance: 81 },
            },
            actionItems: [
              {
                id: 'act-1',
                rank: 1,
                title: 'Increase text contrast',
                description: 'The body text contrast ratio is below WCAG AA recommendations.',
                estimatedImpact: 'high',
                findingType: 'visual',
                findingId: 'vf-1',
              },
            ],
            visualFindings: [],
          }),
        });
      }
    });

    // Mock image request from Supabase storage
    await page.route('https://*.supabase.co/**', async (route) => {
      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        'base64'
      );
      await route.fulfill({ status: 200, contentType: 'image/png', body: pngBuffer });
    });

    // Navigate to Landing
    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });

    // Submit URL
    const input = page.locator('#audit-url-input');
    await input.fill('example.com');
    await page.click('button[type="submit"]');

    // Wait for Report page to complete loading
    await page.waitForURL('**/audit/test-csp-audit-123');
    await page.waitForSelector('text=Audit Report');
    await page.waitForSelector('text=Overall Score');
    await page.waitForSelector('text=84');
    await page.waitForSelector('text=Increase text contrast');

    // Verify /audit/* page has noindex meta tag
    const robotsMeta = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robotsMeta).toContain('noindex');

    // Fail if any CSP violation was logged
    expect(cspErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);

    await page.close();
  }, 40000);
});
