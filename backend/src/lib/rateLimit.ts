import type { FastifyRequest, FastifyReply } from 'fastify';
import { getClientIp } from './clientIp.js';

type UsageCookie = {
  count: number;
  resetAt: string;
};

// In-memory store for IP-based rate limiting
const ipUsageMap = new Map<string, { count: number; resetAt: string }>();

// Simple background cleanup to prevent unbounded memory growth
setInterval(() => {
  const now = new Date();
  for (const [ip, usage] of ipUsageMap.entries()) {
    if (now > new Date(usage.resetAt)) {
      ipUsageMap.delete(ip);
    }
  }
}, 60 * 60 * 1000); // Every hour

/** Reset in-memory IP usage store — only used in tests. */
export function resetIpUsageForTest(): void {
  ipUsageMap.clear();
}

/**
 * Checks both the verdict_usage cookie and the client IP for rate limiting.
 * Both buckets must be under the limit to allow the request.
 * Returns true if allowed, false if blocked.
 */
export function checkAndConsumeRateLimit(request: FastifyRequest, reply: FastifyReply): boolean {
  // Re-read from env at call time so tests can override per-test.
  const maxAudits = parseInt(process.env.RATE_LIMIT_FREE_AUDITS_PER_DAY ?? '3', 10);

  const cookieStr = request.cookies['verdict_usage'];
  
  const initialReset = new Date();
  initialReset.setHours(initialReset.getHours() + 24);
  let usage: UsageCookie = { count: 0, resetAt: initialReset.toISOString() };

  if (cookieStr) {
    try {
      usage = JSON.parse(decodeURIComponent(cookieStr));
    } catch {
      // invalid cookie, reset
      usage = { count: 0, resetAt: initialReset.toISOString() };
    }
  }

  const now = new Date();
  const resetAt = new Date(usage.resetAt);

  // If the window has expired, reset it (24 hours)
  if (now > resetAt) {
    usage.count = 0;
    const nextReset = new Date(now);
    nextReset.setHours(nextReset.getHours() + 24);
    usage.resetAt = nextReset.toISOString();
  }

  if (usage.count >= maxAudits) {
    return false;
  }

  // Double enforcement: Check IP bucket
  const { ip: clientIp } = getClientIp(request);
  let ipUsage = ipUsageMap.get(clientIp);
  
  if (ipUsage) {
    const ipResetAt = new Date(ipUsage.resetAt);
    if (now > ipResetAt) {
      ipUsage = { count: 0, resetAt: usage.resetAt }; // align reset windows
    }
  } else {
    ipUsage = { count: 0, resetAt: usage.resetAt };
  }

  if (ipUsage.count >= maxAudits) {
    return false;
  }

  // Consume both
  usage.count += 1;
  ipUsage.count += 1;
  ipUsageMap.set(clientIp, ipUsage);

  // Set the updated cookie (valid for 30 days)
  reply.setCookie('verdict_usage', JSON.stringify(usage), {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return true;
}
