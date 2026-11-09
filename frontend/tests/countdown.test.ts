import { describe, it, expect } from 'vitest';
import { formatDuration } from '../src/components/Countdown';

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
