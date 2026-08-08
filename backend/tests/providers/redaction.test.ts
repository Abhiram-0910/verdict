/**
 * tests/providers/redaction.test.ts
 *
 * Proves that the pino logger configuration in buildServer() never prints
 * a raw API key in log output, even if a handler accidentally logs the
 * full request body.
 *
 * This is a structural proof, not an integration test — it directly
 * instantiates a pino logger with the exact same redact config used in
 * server.ts and asserts that a serialised log line containing apiKey /
 * byokApiKey never contains the raw secret string.
 */

import { describe, it, expect } from 'vitest';
import pino from 'pino';

// -------------------------------------------------------------------------
// Replicate the EXACT redact configuration from buildServer() in server.ts.
// If server.ts ever changes this config, this test must be updated to match.
// -------------------------------------------------------------------------
const REDACT_CONFIG = {
  paths: ['req.body.apiKey', 'req.body.byokApiKey'],
  censor: '[REDACTED]',
};

const RAW_SECRET = 'sk-test-super-secret-api-key-must-never-appear';
const BYOK_SECRET = 'byok-test-key-also-must-never-appear';

/**
 * Creates a pino logger that writes to an in-memory string instead of stdout.
 * Returns the logger and a function to retrieve accumulated log output.
 */
function makeTestLogger() {
  const lines: string[] = [];
  const logger = pino(
    { redact: REDACT_CONFIG },
    {
      write(chunk: string) {
        lines.push(chunk);
      },
    }
  );
  return { logger, getOutput: () => lines.join('\n') };
}

describe('Pino logger redaction — API key never appears in log output', () => {
  it('redacts req.body.apiKey when the full body is logged', () => {
    const { logger, getOutput } = makeTestLogger();

    // Simulate what a Fastify request-body log line might look like
    logger.info({
      req: {
        body: {
          provider: 'openai',
          apiKey: RAW_SECRET,
        },
      },
    }, 'incoming request');

    const output = getOutput();
    expect(output).not.toContain(RAW_SECRET);
    expect(output).toContain('[REDACTED]');
  });

  it('redacts req.body.byokApiKey when the full body is logged', () => {
    const { logger, getOutput } = makeTestLogger();

    logger.info({
      req: {
        body: {
          url: 'https://example.com',
          byokApiKey: BYOK_SECRET,
        },
      },
    }, 'byok audit submission');

    const output = getOutput();
    expect(output).not.toContain(BYOK_SECRET);
    expect(output).toContain('[REDACTED]');
  });

  it('does NOT redact unrelated fields (control check)', () => {
    const { logger, getOutput } = makeTestLogger();

    logger.info({
      req: {
        body: {
          url: 'https://example.com',
          provider: 'gemini',
        },
      },
    }, 'unrelated body');

    const output = getOutput();
    // These should pass through untouched
    expect(output).toContain('example.com');
    expect(output).toContain('gemini');
  });

  it('redacts apiKey even if it appears alongside other body fields', () => {
    const { logger, getOutput } = makeTestLogger();

    logger.info({
      req: {
        body: {
          provider: 'anthropic',
          apiKey: RAW_SECRET,
          extraField: 'safe-value',
        },
      },
    }, 'mixed body');

    const output = getOutput();
    expect(output).not.toContain(RAW_SECRET);
    expect(output).toContain('[REDACTED]');
    // Safe fields should still be present
    expect(output).toContain('safe-value');
    expect(output).toContain('anthropic');
  });
});
