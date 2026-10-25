import type { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import net from 'node:net';
import { createForbiddenBlockList } from '../capture/egressProxy.js';
import { getPendingCount } from '../capture/queue.js';
import type { ProviderName } from '../providers/types.js';

// ── 1. IP Literal Blocking ───────────────────────────────────────────────────
const { isForbidden } = createForbiddenBlockList();

export interface IpLiteralCheckResult {
  isIp: boolean;
  isBlocked: boolean;
  address?: string;
}

export function checkIpLiteral(urlStr: string): IpLiteralCheckResult {
  try {
    const u = new URL(urlStr);
    const cleanHost = u.hostname.replace(/^\[|\]$/g, '');
    const isIp = net.isIP(cleanHost) !== 0;
    if (!isIp) {
      return { isIp: false, isBlocked: false };
    }
    const blocked = isForbidden(cleanHost);
    return { isIp: true, isBlocked: blocked, address: cleanHost };
  } catch {
    return { isIp: false, isBlocked: false };
  }
}

// ── 2. BYOK Key Validation & Caching ─────────────────────────────────────────
interface KeyCacheEntry {
  expiresAt: number;
}

const byokKeyCache = new Map<string, KeyCacheEntry>();

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function clearByokKeyCache(): void {
  byokKeyCache.clear();
}

export async function validateByokApiKey(
  provider: ProviderName,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  if (!apiKey || apiKey.trim() === '') return false;

  const keyHash = hashApiKey(apiKey);
  const cached = byokKeyCache.get(keyHash);
  if (cached && Date.now() < cached.expiresAt) {
    return true;
  }

  const signal = AbortSignal.timeout(8000);
  let isValid = false;

  try {
    if (provider === 'openai') {
      const res = await fetchFn('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
      });
      isValid = res.ok;
    } else if (provider === 'xai') {
      const res = await fetchFn('https://api.x.ai/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
      });
      isValid = res.ok;
    } else if (provider === 'anthropic') {
      const res = await fetchFn('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        signal,
      });
      isValid = res.ok;
    } else if (provider === 'gemini') {
      const res = await fetchFn(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
        { signal },
      );
      isValid = res.ok;
    } else if (provider === 'openrouter') {
      const res = await fetchFn('https://openrouter.ai/api/v1/key', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
      });
      isValid = res.ok;
    }
  } catch {
    isValid = false;
  }

  if (isValid) {
    byokKeyCache.set(keyHash, {
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes TTL
    });
  }

  return isValid;
}

// ── 3. BYOK Rate Limiting ────────────────────────────────────────────────────
type UsageCookie = {
  count: number;
  resetAt: string;
};

const byokIpUsageMap = new Map<string, { count: number; resetAt: string }>();

export function resetByokRateLimits(): void {
  byokIpUsageMap.clear();
}

export function checkAndConsumeByokRateLimit(request: FastifyRequest, reply: FastifyReply): boolean {
  const maxAudits = parseInt(process.env.BYOK_RATE_LIMIT_PER_DAY ?? '20', 10);
  const cookieStr = request.cookies['verdict_byok_usage'];

  const initialReset = new Date();
  initialReset.setHours(initialReset.getHours() + 24);
  let usage: UsageCookie = { count: 0, resetAt: initialReset.toISOString() };

  if (cookieStr) {
    try {
      usage = JSON.parse(decodeURIComponent(cookieStr));
    } catch {
      usage = { count: 0, resetAt: initialReset.toISOString() };
    }
  }

  const now = new Date();
  const resetAt = new Date(usage.resetAt);

  if (now > resetAt) {
    usage.count = 0;
    const nextReset = new Date(now);
    nextReset.setHours(nextReset.getHours() + 24);
    usage.resetAt = nextReset.toISOString();
  }

  if (usage.count >= maxAudits) {
    return false;
  }

  const clientIp = request.ip || 'unknown';
  let ipUsage = byokIpUsageMap.get(clientIp);

  if (ipUsage) {
    const ipResetAt = new Date(ipUsage.resetAt);
    if (now > ipResetAt) {
      ipUsage = { count: 0, resetAt: usage.resetAt };
    }
  } else {
    ipUsage = { count: 0, resetAt: usage.resetAt };
  }

  if (ipUsage.count >= maxAudits) {
    return false;
  }

  usage.count += 1;
  ipUsage.count += 1;
  byokIpUsageMap.set(clientIp, ipUsage);

  reply.setCookie('verdict_byok_usage', JSON.stringify(usage), {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return true;
}

// ── 4. Queue Concurrency & Cap ────────────────────────────────────────────────
const inFlightIps = new Set<string>();

export function getInFlightIps(): string[] {
  return Array.from(inFlightIps);
}

export function resetInFlightIps(): void {
  inFlightIps.clear();
}

export function hasInFlightJob(ip: string): boolean {
  return inFlightIps.has(ip);
}

export function trackInFlightStart(ip: string): void {
  inFlightIps.add(ip);
}

export function trackInFlightEnd(ip: string): void {
  inFlightIps.delete(ip);
}

export function checkQueueCapacity(clientIp: string): {
  allowed: boolean;
  status?: number;
  code?: string;
  detail?: string;
  retryAfterSeconds?: number;
} {
  // Max 1 pending-or-running job per IP
  if (hasInFlightJob(clientIp)) {
    return {
      allowed: false,
      status: 429,
      detail: 'An audit is already in progress for this IP. Please wait for it to complete.',
    };
  }

  // Cap pending jobs
  const maxPending = parseInt(process.env.MAX_PENDING_JOBS ?? '10', 10);
  if (getPendingCount() >= maxPending) {
    return {
      allowed: false,
      status: 503,
      code: 'BUSY',
      retryAfterSeconds: 30,
      detail: 'Server is currently at capacity. Please try again later.',
    };
  }

  return { allowed: true };
}

// ── 5. Global Default Path Budget & Gemini Circuit Breaker ───────────────────
let globalDailyBudgetCount = 0;
let currentBudgetUtcDay = new Date().toISOString().slice(0, 10);
let circuitBreakerActiveUntil: Date | null = null;

export function resetGlobalBudget(): void {
  globalDailyBudgetCount = 0;
  currentBudgetUtcDay = new Date().toISOString().slice(0, 10);
  circuitBreakerActiveUntil = null;
}

export function getGlobalBudgetCount(): number {
  return globalDailyBudgetCount;
}

export function recordDefaultPathAudit(): void {
  const todayUtc = new Date().toISOString().slice(0, 10);
  if (todayUtc !== currentBudgetUtcDay) {
    currentBudgetUtcDay = todayUtc;
    globalDailyBudgetCount = 0;
  }
  globalDailyBudgetCount++;
}

export function getNextMidnightLosAngeles(referenceDate = new Date()): Date {
  const tzFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });

  const parts = tzFormatter.formatToParts(referenceDate);
  const month = parseInt(parts.find((p) => p.type === 'month')?.value || '1', 10);
  const day = parseInt(parts.find((p) => p.type === 'day')?.value || '1', 10);
  const year = parseInt(parts.find((p) => p.type === 'year')?.value || '1970', 10);

  // Next calendar day in LA
  const nextDateInLa = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0));
  const nextParts = tzFormatter.formatToParts(nextDateInLa);
  const nextMonth = nextParts.find((p) => p.type === 'month')?.value;
  const nextDay = nextParts.find((p) => p.type === 'day')?.value;
  const nextYear = nextParts.find((p) => p.type === 'year')?.value;

  const clockFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });

  function getLaOffsetMs(date: Date): number {
    const p = clockFormatter.formatToParts(date);
    const getVal = (type: string) => parseInt(p.find((x) => x.type === type)?.value || '0', 10);
    const laAsUtc = Date.UTC(
      getVal('year'),
      getVal('month') - 1,
      getVal('day'),
      getVal('hour'),
      getVal('minute'),
      getVal('second'),
    );
    return laAsUtc - date.getTime();
  }

  const targetLaAsUtc = Date.UTC(
    parseInt(nextYear!, 10),
    parseInt(nextMonth!, 10) - 1,
    parseInt(nextDay!, 10),
    0,
    0,
    0,
  );

  let candidate = new Date(targetLaAsUtc + 8 * 3600 * 1000);
  let offset = getLaOffsetMs(candidate);
  let result = new Date(targetLaAsUtc - offset);
  offset = getLaOffsetMs(result);
  result = new Date(targetLaAsUtc - offset);
  return result;
}

export function extractGeminiPerDayQuotaId(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const errObj = error as any;

  function hasPerDayViolation(violations: unknown[]): boolean {
    if (!Array.isArray(violations)) return false;
    for (const v of violations) {
      if (v && typeof v === 'object') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const qId = (v as any).quotaId;
        if (typeof qId === 'string' && qId.includes('PerDay')) {
          return true;
        }
      }
    }
    return false;
  }

  function checkDetails(details: unknown[]): boolean {
    if (!Array.isArray(details)) return false;
    for (const d of details) {
      if (d && typeof d === 'object') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (hasPerDayViolation((d as any).violations)) {
          return true;
        }
      }
    }
    return false;
  }

  if (checkDetails(errObj.details)) return true;
  if (checkDetails(errObj.error?.details)) return true;

  if (typeof errObj.message === 'string') {
    try {
      const match = errObj.message.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (checkDetails(parsed.details) || checkDetails(parsed.error?.details)) {
          return true;
        }
      }
    } catch {}
  }

  return false;
}

export function tripGeminiCircuitBreaker(error: unknown): boolean {
  if (extractGeminiPerDayQuotaId(error)) {
    circuitBreakerActiveUntil = getNextMidnightLosAngeles();
    console.warn(
      `[Circuit Breaker] Gemini PerDay quota tripped. Breaker active until ${circuitBreakerActiveUntil.toISOString()}`,
    );
    return true;
  }
  return false;
}

export function setCircuitBreakerUntil(date: Date | null): void {
  circuitBreakerActiveUntil = date;
}

export function checkDefaultPathBudget(): {
  allowed: boolean;
  code?: string;
  resetAt?: string;
  detail?: string;
} {
  const now = new Date();

  // 1. Check Circuit Breaker
  if (circuitBreakerActiveUntil && now < circuitBreakerActiveUntil) {
    return {
      allowed: false,
      code: 'AI_QUOTA_EXHAUSTED',
      resetAt: circuitBreakerActiveUntil.toISOString(),
      detail: 'The AI service daily quota is currently exhausted. Please use your own API key or try again tomorrow.',
    };
  }

  // 2. Check Global Daily Budget (UTC day)
  const todayUtc = now.toISOString().slice(0, 10);
  if (todayUtc !== currentBudgetUtcDay) {
    currentBudgetUtcDay = todayUtc;
    globalDailyBudgetCount = 0;
  }

  const globalLimit = parseInt(process.env.GLOBAL_DAILY_AUDITS ?? '150', 10);
  if (globalDailyBudgetCount >= globalLimit) {
    const nextMidnightUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
    return {
      allowed: false,
      code: 'AI_QUOTA_EXHAUSTED',
      resetAt: nextMidnightUtc.toISOString(),
      detail: 'The global daily limit for free audits has been reached. Please try again tomorrow or use your own API key.',
    };
  }

  return { allowed: true };
}
