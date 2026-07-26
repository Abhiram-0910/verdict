import type { FastifyRequest, FastifyReply } from 'fastify';

const MAX_AUDITS = parseInt(process.env.RATE_LIMIT_FREE_AUDITS_PER_DAY ?? '3', 10);

type UsageCookie = {
  count: number;
  resetAt: string;
};

/**
 * Checks the verdict_usage cookie for rate limiting.
 * Returns true if the request is allowed (and sets the updated cookie).
 * Returns false if the request is blocked.
 */
export function checkAndConsumeRateLimit(request: FastifyRequest, reply: FastifyReply): boolean {
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

  if (usage.count >= MAX_AUDITS) {
    return false;
  }

  usage.count += 1;

  // Set the updated cookie (valid for 30 days)
  reply.setCookie('verdict_usage', JSON.stringify(usage), {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return true;
}
