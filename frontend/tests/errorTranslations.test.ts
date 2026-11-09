import { describe, it, expect } from 'vitest';
import { translateError, ERROR_TRANSLATIONS } from '../src/lib/errorTranslations';

describe('errorTranslations', () => {
  it('translates BUSY error code into a friendly capacity message', () => {
    const msg = translateError('BUSY');
    expect(msg).toBe(ERROR_TRANSLATIONS.BUSY);
    expect(msg).toContain('capacity');
  });

  it('translates AI_QUOTA_EXHAUSTED into a friendly quota message', () => {
    const msg = translateError('AI_QUOTA_EXHAUSTED');
    expect(msg).toBe(ERROR_TRANSLATIONS.AI_QUOTA_EXHAUSTED);
    expect(msg).toContain('daily quota');
  });

  it('translates INVALID_API_KEY into an informative key error message', () => {
    const msg = translateError('INVALID_API_KEY');
    expect(msg).toBe(ERROR_TRANSLATIONS.INVALID_API_KEY);
    expect(msg).toContain('API key was rejected');
  });

  it('translates BLOCKED into a friendly firewall / captcha explanation', () => {
    const msg = translateError('BLOCKED');
    expect(msg).toBe(ERROR_TRANSLATIONS.BLOCKED);
    expect(msg).toContain('actively blocked');
  });

  it('translates SERVER_RESTART into a timeout/restart explanation', () => {
    const msg = translateError('SERVER_RESTART');
    expect(msg).toBe(ERROR_TRANSLATIONS.SERVER_RESTART);
    expect(msg).toContain('interrupted by a server restart or timeout');
  });

  it('translates private/internal IP address rejection messages correctly', () => {
    const msg1 = translateError('PRIVATE_IP_ADDRESS');
    expect(msg1).toContain('Audits cannot be performed on private, loopback, or internal IP addresses.');

    const msg2 = translateError('PRIVATE_IP');
    expect(msg2).toContain('Audits cannot be performed on private, loopback, or internal IP addresses.');

    const msg3 = translateError('Audits cannot be performed on private, loopback, or internal IP addresses.');
    expect(msg3).toContain('Audits cannot be performed on private, loopback, or internal IP addresses.');
  });

  it('translates general capture and agent errors', () => {
    expect(translateError('TIMEOUT')).toContain('took too long to load');
    expect(translateError('AI_TIMEOUT')).toContain('AI took too long');
    expect(translateError('AI_RATE_LIMIT')).toContain('AI provider is temporarily overwhelmed');
    expect(translateError('AI_MALFORMED_OUTPUT')).toContain('invalid response');
  });

  it('falls back gracefully to raw error string if unknown code', () => {
    expect(translateError('CUSTOM_ERROR_REASON')).toBe('CUSTOM_ERROR_REASON');
    expect(translateError(null)).toBe('Unknown error occurred');
    expect(translateError(undefined)).toBe('Unknown error occurred');
  });
});
