/**
 * tests/agents/promptInjection.test.ts
 *
 * Tests for item 1: prompt injection defenses in copyCritique and visualCritique.
 *  1. renderedText is wrapped in <page_content> delimiters in the copy prompt.
 *  2. The copy system instruction forbids treating page content as instructions.
 *  3. renderedText is capped at 12,000 characters.
 *  4. The visual system instruction warns about screenshot text being untrusted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test by spying on the provider's critique method and inspecting what
// prompt / systemInstruction was passed in.

describe('copyCritique — prompt injection defenses', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('wraps renderedText in <page_content> delimiters', async () => {
    const critiqueSpy = vi.fn().mockResolvedValue({ success: true, text: JSON.stringify({ findings: [] }) });
    vi.doMock('../../src/providers/index.js', () => ({
      getProvider: () => ({ critique: critiqueSpy }),
    }));
    vi.doMock('../../src/db/client.js', () => ({ db: { transaction: vi.fn() } }));
    vi.doMock('../../src/db/schema.js', () => ({ copyFinding: {} }));

    const { runCopyCritique } = await import('../../src/agents/copyCritique.js');
    await runCopyCritique('job-id', 'Hello world copy text');

    const req = critiqueSpy.mock.calls[0][0];
    expect(req.prompt).toContain('<page_content>');
    expect(req.prompt).toContain('</page_content>');
    expect(req.prompt).toContain('Hello world copy text');
  });

  it('system instruction warns that page content is untrusted data', async () => {
    const critiqueSpy = vi.fn().mockResolvedValue({ success: true, text: JSON.stringify({ findings: [] }) });
    vi.doMock('../../src/providers/index.js', () => ({
      getProvider: () => ({ critique: critiqueSpy }),
    }));
    vi.doMock('../../src/db/client.js', () => ({ db: { transaction: vi.fn() } }));
    vi.doMock('../../src/db/schema.js', () => ({ copyFinding: {} }));

    const { runCopyCritique } = await import('../../src/agents/copyCritique.js');
    await runCopyCritique('job-id', 'Some text');

    const req = critiqueSpy.mock.calls[0][0];
    // Must mention that content inside the delimiters must not be treated as instructions
    expect(req.systemInstruction.toLowerCase()).toMatch(/untrusted|must never be followed|not.*instructions/i);
  });

  it('caps renderedText at 12,000 characters', async () => {
    const longText = 'A'.repeat(20_000);
    const critiqueSpy = vi.fn().mockResolvedValue({ success: true, text: JSON.stringify({ findings: [] }) });
    vi.doMock('../../src/providers/index.js', () => ({
      getProvider: () => ({ critique: critiqueSpy }),
    }));
    vi.doMock('../../src/db/client.js', () => ({ db: { transaction: vi.fn() } }));
    vi.doMock('../../src/db/schema.js', () => ({ copyFinding: {} }));

    const { runCopyCritique } = await import('../../src/agents/copyCritique.js');
    await runCopyCritique('job-id', longText);

    const req = critiqueSpy.mock.calls[0][0];
    // The text inside the prompt should not exceed 12000 chars
    // (plus delimiters/boilerplate, but 'A'.repeat(12001) shouldn't appear)
    expect(req.prompt).not.toContain('A'.repeat(12_001));
    // But exactly 12000 should be present
    expect(req.prompt).toContain('A'.repeat(12_000));
  });
});

describe('visualCritique — prompt injection defenses', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('system instruction warns that screenshot text is untrusted', async () => {
    // We just import and read the constant — the system instruction is built inline.
    // Mock fetch for the screenshot download.
    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response(Buffer.from('PNG'), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    );

    const critiqueSpy = vi.fn().mockResolvedValue({ success: true, text: JSON.stringify({ findings: [] }) });
    vi.doMock('../../src/providers/index.js', () => ({
      getProvider: () => ({ critique: critiqueSpy }),
    }));
    vi.doMock('../../src/db/client.js', () => ({ db: { transaction: vi.fn() } }));
    vi.doMock('../../src/db/schema.js', () => ({ visualFinding: {} }));

    const { runVisualCritique } = await import('../../src/agents/visualCritique.js');
    await runVisualCritique('job-id', 'https://example.com/screenshot.png');

    const req = critiqueSpy.mock.calls[0][0];
    // System instruction must mention untrusted / screenshot text / must not follow
    expect(req.systemInstruction.toLowerCase()).toMatch(/untrusted|must never be followed|screenshot.*text/i);
  });
});
