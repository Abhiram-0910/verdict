import { useState, useEffect } from 'react';

interface CountdownProps {
  targetDate: Date | string;
  isApproximate?: boolean;
  onComplete?: () => void;
  prefix?: string;
  className?: string;
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(' ');
}

/**
 * Validates that the input is a valid ISO 8601 date-time string in the future.
 */
export function isValidFutureIso(dateStr: unknown): dateStr is string {
  if (typeof dateStr !== 'string') {
    return false;
  }
  const trimmed = dateStr.trim();
  if (!trimmed) {
    return false;
  }
  // Standard ISO 8601 date-time format (YYYY-MM-DDTHH:mm:ss...)
  const isIsoFormat = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)?$/.test(trimmed);
  if (!isIsoFormat) {
    return false;
  }
  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) {
    return false;
  }
  return timestamp > Date.now();
}

export function Countdown({
  targetDate,
  isApproximate = false,
  onComplete,
  prefix = 'Resets in',
  className = '',
}: CountdownProps) {
  const targetTime = new Date(targetDate).getTime();
  const [remainingMs, setRemainingMs] = useState<number>(() => Math.max(0, targetTime - Date.now()));

  useEffect(() => {
    // Initial check
    const diff = targetTime - Date.now();
    if (diff <= 0) {
      setRemainingMs(0);
      onComplete?.();
      return;
    }
    setRemainingMs(diff);

    const intervalId = setInterval(() => {
      const currentDiff = targetTime - Date.now();
      if (currentDiff <= 0) {
        setRemainingMs(0);
        clearInterval(intervalId);
        onComplete?.();
      } else {
        setRemainingMs(currentDiff);
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, [targetTime, onComplete]);

  if (remainingMs <= 0) {
    return <span className={`font-mono ${className}`}>Ready</span>;
  }

  const formatted = formatDuration(remainingMs);

  return (
    <span className={`font-mono tracking-tight ${className}`}>
      {prefix} {formatted}
      {isApproximate && <span className="ml-1 text-xs opacity-75 font-sans">(approximate)</span>}
    </span>
  );
}
