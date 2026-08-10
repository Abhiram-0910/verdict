/**
 * capture/session.ts
 *
 * Single Playwright Chromium session per audit job. Three things happen
 * in one page load — never a second browser instance:
 *
 *   1. Desktop screenshot (1440×900) and mobile screenshot (375×812)
 *   2. Web Vitals: load time, LCP, CLS — via PerformanceObserver injection
 *   3. axe-core accessibility scan against the rendered page
 *
 * Settle strategy: after `waitUntil: 'load'`, wait for document.fonts.ready
 * (page.evaluate, capped at 3s). If fonts aren't ready in time, the job
 * succeeds with partial=true — captured data is still valid, just note the
 * caveat.
 *
 * Failure contract: any hard failure returns CaptureFailure with an explicit
 * reason. Partial results are NEVER dressed up as complete successes.
 *
 * DB writes (CaptureResult rows, AccessibilityFinding rows) are NOT done
 * here. This module returns a typed result object; persistence is the
 * caller's responsibility (Task 7 wiring).
 */

import { chromium, type Browser, type Page } from 'playwright';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { enqueue } from './queue.js';
import { db, captureResult, accessibilityFinding, auditJob } from '../db/index.js';
import { eq, sql } from 'drizzle-orm';

// Read the axe-core bundle once at startup — injected into every page via
// addScriptTag({ content }) so no CDN request is needed at audit time.
// This bypasses pages whose CSP blocks external script origins (nonce/hash
// CSPs that also block inline scripts remain a known limitation).
const AXE_BUNDLE: string = readFileSync(
  join(__dirname, '..', '..', 'node_modules', 'axe-core', 'axe.min.js'),
  'utf-8',
);

// ── Constants ────────────────────────────────────────────────────────────────

/** Application-layer limit — enforced before any Supabase upload call. */
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5 MB per CLAUDE.md rule

const NAVIGATION_TIMEOUT_MS = 30_000;
const FONTS_READY_TIMEOUT_MS = 3_000;

const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MOBILE_VIEWPORT = { width: 375, height: 812 };

/**
 * Versioned, lockfile-pinned axe-core bundle read from node_modules at
 * startup and injected via page.addScriptTag({ content }).
 *
 * Known limitation: pages with a strict CSP using nonce or hash directives
 * (not just external-origin blocks) will still reject inline script injection.
 * This is a real constraint either way; documented as AXE_FAILED in those cases.
 */


// ── Public types ─────────────────────────────────────────────────────────────

export type AxeViolation = {
  id: string;
  impact: 'minor' | 'moderate' | 'serious' | 'critical';
  description: string;
  helpUrl: string;
  /** Count of affected DOM nodes. */
  nodes: number;
};

export type WebVitals = {
  /** Wall-clock ms from navigation start to `load` event. */
  loadTimeMs: number;
  /** Largest Contentful Paint in ms. null if not emitted (e.g. trivial pages). */
  lcp: number | null;
  /** Cumulative Layout Shift score. null if no layout-shift entries observed. */
  cls: number | null;
};

/**
 * All three sub-tasks succeeded.
 *
 * `partial` is true when a soft degradation occurred (e.g. fonts didn't
 * finish loading within the 3s cap) but real data was still captured.
 * This is a success with a caveat — not an undefined third state.
 */
export type CaptureSuccess = {
  error: false;
  desktopScreenshotUrl: string;
  mobileScreenshotUrl: string;
  webVitals: WebVitals;
  accessibilityViolations: AxeViolation[];
  renderedText: string | null;
  partial: boolean;
  partialReason: string | null;
};

/**
 * Hard failure — no usable data was captured. The caller must record
 * this reason on the AuditJob and surface it explicitly in the UI.
 */
export type CaptureFailure = {
  error: true;
  reason:
    | 'TIMEOUT'
    | 'BLOCKED'
    | 'NAVIGATION_ERROR'
    | 'SCREENSHOT_TOO_LARGE'
    | 'UPLOAD_FAILED'
    | 'DB_WRITE_FAILED';
  detail: string;
  /** Present only when the capture succeeded but persistence failed. */
  capturedData?: CaptureSuccess;
};

export type CaptureResult = CaptureSuccess | CaptureFailure;

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Tagged error so the top-level catch can route to the right CaptureFailure reason. */
class CaptureError extends Error {
  constructor(
    public readonly code: CaptureFailure['reason'],
    message: string,
  ) {
    super(message);
    this.name = 'CaptureError';
  }
}

function buildSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new CaptureError(
      'UPLOAD_FAILED',
      'SUPABASE_URL or SUPABASE_SERVICE_KEY env vars are not set',
    );
  }
  return createClient(url, key);
}

/**
 * Wait for document.fonts.ready in the page, capped at FONTS_READY_TIMEOUT_MS.
 *
 * If the cap fires first, marks the result partial but does NOT throw —
 * capture continues with whatever fonts have loaded.
 */
async function waitForFonts(
  page: Page,
  partialState: { value: boolean; reason: string | null },
): Promise<void> {
  try {
    await Promise.race([
      page.evaluate(() => document.fonts.ready),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('document.fonts.ready did not resolve within cap')),
          FONTS_READY_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch {
    // Fonts didn't load in time — mark partial once, then continue
    if (!partialState.value) {
      partialState.value = true;
      partialState.reason = 'FONTS_NOT_READY';
    }
  }
}

/**
 * Check size, then upload a screenshot buffer to Supabase Storage.
 * Throws CaptureError on size violation or upload failure.
 */
async function uploadScreenshot(
  supabase: SupabaseClient,
  buffer: Buffer,
  storagePath: string,
  label: string,
): Promise<string> {
  // Application-layer size gate — required by CLAUDE.md before any upload call
  if (buffer.byteLength >= MAX_SCREENSHOT_BYTES) {
    throw new CaptureError(
      'SCREENSHOT_TOO_LARGE',
      `${label} screenshot is ${buffer.byteLength} bytes — exceeds the 5 MB pre-upload limit`,
    );
  }

  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'verdict-screenshots';
  const { error } = await supabase.storage.from(bucket).upload(storagePath, buffer, {
    contentType: 'image/png',
    upsert: true,
  });

  if (error) {
    throw new CaptureError(
      'UPLOAD_FAILED',
      `Supabase Storage upload failed for ${label}: ${error.message}`,
    );
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  return data.publicUrl;
}

// ── Core capture logic (always invoked through the queue) ────────────────────

async function runCapture(url: string, jobId: string): Promise<CaptureResult> {
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({
      // Required for sandboxed container environments (Render, Docker)
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.newContext({ viewport: DESKTOP_VIEWPORT });
    const page = await context.newPage();

    // Inject LCP + CLS PerformanceObservers before navigation fires, so
    // entries emitted early in the page load are captured via `buffered: true`.
    // String form is used here to avoid TypeScript DOM-vs-Node type friction
    // inside a function serialised and sent to the browser by Playwright.
    await page.addInitScript(`
      window.__verdictVitals = { lcp: null, cls: 0, clsReported: false };

      try {
        new PerformanceObserver(function(list) {
          var entries = list.getEntries();
          var last = entries[entries.length - 1];
          if (last) window.__verdictVitals.lcp = last.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      } catch (_) { /* not supported in this browser/context — lcp stays null */ }

      try {
        new PerformanceObserver(function(list) {
          var entries = list.getEntries();
          for (var i = 0; i < entries.length; i++) {
            if (!entries[i].hadRecentInput) {
              window.__verdictVitals.cls += entries[i].value;
            }
          }
          window.__verdictVitals.clsReported = true;
        }).observe({ type: 'layout-shift', buffered: true });
      } catch (_) { /* not supported — cls stays null */ }
    `);

    // ── Navigate ─────────────────────────────────────────────────────────────

    const navStart = Date.now();
    let response: Awaited<ReturnType<Page['goto']>> = null;

    try {
      response = await page.goto(url, {
        waitUntil: 'load',
        timeout: NAVIGATION_TIMEOUT_MS,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = /timeout/i.test(msg);
      return {
        error: true,
        reason: isTimeout ? 'TIMEOUT' : 'NAVIGATION_ERROR',
        detail: isTimeout
          ? `Page did not finish loading within ${NAVIGATION_TIMEOUT_MS}ms`
          : msg,
      };
    }

    // HTTP 4xx / 5xx — treat as a blocked or broken page
    if (response !== null && response.status() >= 400) {
      return {
        error: true,
        reason: 'BLOCKED',
        detail: `Server returned HTTP ${response.status()} — page may be blocking headless browsers`,
      };
    }

    const loadTimeMs = Date.now() - navStart;

    // ── Settle: document.fonts.ready, capped at 3s ───────────────────────────

    const partialState: { value: boolean; reason: string | null } = {
      value: false,
      reason: null,
    };
    await waitForFonts(page, partialState);

    // ── Extract Text ──────────────────────────────────────────────────────────
    
    let renderedText: string | null = null;
    try {
      renderedText = await page.evaluate(() => document.body.innerText);
    } catch {
      // Graceful degradation: if text extraction fails, leave it null
    }

    // ── Desktop screenshot ────────────────────────────────────────────────────

    const supabase = buildSupabaseClient();
    const desktopBuf = await page.screenshot({ type: 'png', fullPage: false });
    const desktopScreenshotUrl = await uploadScreenshot(
      supabase,
      desktopBuf,
      `${jobId}/desktop.png`,
      'desktop',
    );

    // ── Mobile viewport → re-settle → mobile screenshot ───────────────────────

    await page.setViewportSize(MOBILE_VIEWPORT);
    await waitForFonts(page, partialState);

    const mobileBuf = await page.screenshot({ type: 'png', fullPage: false });
    const mobileScreenshotUrl = await uploadScreenshot(
      supabase,
      mobileBuf,
      `${jobId}/mobile.png`,
      'mobile',
    );

    // ── Collect Web Vitals ────────────────────────────────────────────────────

    type RawVitals = { lcp: number | null; cls: number; clsReported: boolean };
    const raw = await page.evaluate<RawVitals>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__verdictVitals as RawVitals,
    );

    const webVitals: WebVitals = {
      loadTimeMs,
      lcp: raw.lcp,
      // Only surface CLS if at least one layout-shift entry was observed
      cls: raw.clsReported ? raw.cls : null,
    };

    // ── axe-core accessibility scan ───────────────────────────────────────────

    let accessibilityViolations: AxeViolation[] = [];

    try {
      await page.addScriptTag({ content: AXE_BUNDLE });

      type RawViolation = {
        id: string;
        impact: string;
        description: string;
        helpUrl: string;
        nodes: unknown[];
      };

      accessibilityViolations = await page.evaluate<AxeViolation[]>(() =>
        new Promise<AxeViolation[]>((resolve, reject) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).axe.run(
            document,
            {},
            (err: Error | null, results: { violations: RawViolation[] }) => {
              if (err) { reject(err); return; }
              resolve(
                results.violations.map((v) => ({
                  id: v.id,
                  impact: v.impact as AxeViolation['impact'],
                  description: v.description,
                  helpUrl: v.helpUrl,
                  nodes: v.nodes.length,
                })),
              );
            },
          );
        }),
      );
    } catch (err) {
      // axe injection/evaluation failures are soft — e.g. pages with strict CSP
      // that block inline scripts. Degrade to empty findings and mark partial
      // rather than discarding valid screenshots and Web Vitals.
      if (!partialState.value) {
        partialState.value = true;
        partialState.reason = 'AXE_FAILED';
      }
      // accessibilityViolations stays [] — empty findings, not a hard failure
    }

    // ── Success ───────────────────────────────────────────────────────────────

    return {
      error: false,
      desktopScreenshotUrl,
      mobileScreenshotUrl,
      webVitals,
      accessibilityViolations,
      renderedText,
      partial: partialState.value,
      partialReason: partialState.reason,
    };
  } catch (err) {
    // Route tagged errors to their specific failure reason
    if (err instanceof CaptureError) {
      return { error: true, reason: err.code, detail: err.message };
    }
    return {
      error: true,
      reason: 'NAVIGATION_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    // Always close the browser — even on early return paths
    if (browser) await browser.close();
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Capture a URL. Resolves with CaptureResult.
 *
 * NOTE: This function blocks the thread during execution. It must be wrapped in a
 * single-concurrency queue by the caller to stay within Render's 512 MB RAM ceiling.
 */
export async function captureUrl(url: string, jobId: string): Promise<CaptureResult> {
  const result = await runCapture(url, jobId);

  if (result.error) {
    return result;
  }

  try {
    await db.transaction(async (tx) => {
      await tx.insert(captureResult).values({
        auditJobId: jobId,
        desktopScreenshotUrl: result.desktopScreenshotUrl,
        mobileScreenshotUrl: result.mobileScreenshotUrl,
        renderedText: result.renderedText,
        loadTimeMs: result.webVitals.loadTimeMs,
        lcp: result.webVitals.lcp,
        cls: result.webVitals.cls !== null ? result.webVitals.cls.toString() : null,
        partial: result.partial,
        partialReason: result.partialReason,
      });

      if (result.accessibilityViolations.length > 0) {
        const axeRows = result.accessibilityViolations.map((v) => ({
          auditJobId: jobId,
          ruleId: v.id,
          impact: v.impact,
          description: v.description,
          helpUrl: v.helpUrl,
          nodeCount: v.nodes,
        }));
        await tx.insert(accessibilityFinding).values(axeRows);
      }
    });
    return result;
  } catch (err) {
    return {
      error: true,
      reason: 'DB_WRITE_FAILED',
      detail: err instanceof Error ? err.message : String(err),
      capturedData: result,
    };
  }
}

/**
 * Safe, queued entry point for the orchestration layer. Enforces single concurrency
 * and sets the DB status to 'running' at the exact moment execution begins.
 */
export function runQueuedCapture(url: string, jobId: string): Promise<CaptureResult> {
  return enqueue(async () => {
    await db.update(auditJob).set({ 
      status: 'running',
      startedAt: sql`now()`
    }).where(eq(auditJob.id, jobId));
    return captureUrl(url, jobId);
  });
}
