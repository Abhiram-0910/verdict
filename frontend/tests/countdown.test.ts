import { describe, it, expect } from 'vitest';
import { formatDuration, isValidFutureIso } from '../src/components/Countdown';

describe('Countdown formatting and logic', () => {
  it('formats zero or negative durations as 0s', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(-5000)).toBe('0s');
  });

  it('formats seconds only', () => {
    expect(formatDuration(45000)).toBe('45s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(125000)).toBe('2m 5s');
  });

  it('formats hours, minutes, and seconds', () => {
    // 3 hours, 25 minutes, 10 seconds = (3 * 3600 + 25 * 60 + 10) * 1000
    const ms = (3 * 3600 + 25 * 60 + 10) * 1000;
    expect(formatDuration(ms)).toBe('3h 25m 10s');
  });

  it('formats days, hours, minutes, and seconds', () => {
    // 1 day, 2 hours, 15 minutes, 30 seconds
    const ms = (24 * 3600 + 2 * 3600 + 15 * 60 + 30) * 1000;
    expect(formatDuration(ms)).toBe('1d 2h 15m 30s');
  });
});

describe('isValidFutureIso', () => {
  it('returns true for valid future ISO 8601 timestamps', () => {
    const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();
    expect(isValidFutureIso(futureDate)).toBe(true);

    const futureWithoutMs = new Date(Date.now() + 86400 * 1000).toISOString().replace(/\.\d{3}/, '');
    expect(isValidFutureIso(futureWithoutMs)).toBe(true);

    // Explicit timezone offset (+02:00)
    const futureWithOffset = '2099-01-01T12:00:00+02:00';
    expect(isValidFutureIso(futureWithOffset)).toBe(true);
  });

  it('returns false for timestamps in the past', () => {
    const pastDate = new Date(Date.now() - 5000).toISOString();
    expect(isValidFutureIso(pastDate)).toBe(false);

    expect(isValidFutureIso('2020-01-01T00:00:00.000Z')).toBe(false);
  });

  it('returns false for missing, invalid, or non-ISO inputs', () => {
    expect(isValidFutureIso(undefined)).toBe(false);
    expect(isValidFutureIso(null)).toBe(false);
    expect(isValidFutureIso(123456789)).toBe(false);
    expect(isValidFutureIso({})).toBe(false);
    expect(isValidFutureIso('')).toBe(false);
    expect(isValidFutureIso('   ')).toBe(false);
    expect(isValidFutureIso('invalid-date')).toBe(false);
    expect(isValidFutureIso('2026-99-99T99:99:99.000Z')).toBe(false);
    expect(isValidFutureIso('12345')).toBe(false);
  });
});
