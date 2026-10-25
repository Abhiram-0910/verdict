import '../../src/env.js';
import { describe, it, expect } from 'vitest';
import { captureUrl, getChromiumProcessCount } from '../../src/capture/session.js';

describe('BLOCKED Classification & Private IP Capture Defenses', () => {
  it('classifies net::ERR_ACCESS_DENIED and SSRF probe of 169.254.169.254 as BLOCKED', async () => {
    const result = await captureUrl('http://169.254.169.254', 'test-blocked-metadata');
    expect(result.error).toBe(true);
    if (result.error) {
      expect(result.reason).toBe('BLOCKED');
      expect(result.detail).toMatch(/SSRF Blocked|403|accessdenied|ERR_ACCESS_DENIED/i);
    }
  }, 35000);

  it('classifies CGNAT probe of 100.64.1.1 as BLOCKED', async () => {
    const result = await captureUrl('http://100.64.1.1', 'test-blocked-cgnat');
    expect(result.error).toBe(true);
    if (result.error) {
      expect(result.reason).toBe('BLOCKED');
      expect(result.detail).toMatch(/SSRF Blocked|403|accessdenied|ERR_ACCESS_DENIED/i);
    }
  }, 35000);

  it('classifies IPv4-mapped IPv6 probe of http://[::ffff:127.0.0.1]/ as BLOCKED without crashing', async () => {
    const result = await captureUrl('http://[::ffff:127.0.0.1]/', 'test-blocked-ipv4-mapped');
    expect(result.error).toBe(true);
    if (result.error) {
      expect(result.reason).toBe('BLOCKED');
    }
  }, 35000);

  it('can query chromium process count cheaply', () => {
    const count = getChromiumProcessCount();
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
