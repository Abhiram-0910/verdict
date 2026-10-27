/**
 * clientIp.ts — Canonical client IP resolution for Verdict.
 *
 * Design rationale (2026-10-27):
 *  - trustProxy is set to FALSE in server.ts. Fastify's request.ip therefore
 *    returns the raw socket peer address, which on Render is an internal proxy
 *    address — never a user identity on its own.
 *  - Render sits behind Cloudflare, which sets cf-connecting-ip to the true
 *    end-user IP and is NOT forwardable by clients (unlike X-Forwarded-For which
 *    Render's proxy appends to rather than overwrites).
 *  - We never read X-Forwarded-For, X-Real-IP, or True-Client-IP for identity.
 *  - If cf-connecting-ip is absent or invalid, we fail closed: all unknown
 *    clients share a single 'socket' bucket rather than getting unlimited fresh
 *    buckets by cycling IPs.
 */

import net from 'node:net';
import type { FastifyRequest } from 'fastify';
import { createForbiddenBlockList } from '../capture/egressProxy.js';

const { isForbidden } = createForbiddenBlockList();

export interface ClientIpResult {
  ip: string;
  source: 'cf-connecting-ip' | 'socket';
}

// Rate-limit warn logs to at most once per minute to avoid log flooding.
let lastWarnAt = 0;
const WARN_INTERVAL_MS = 60_000;

function maybeWarn(msg: string, logger: { warn: (msg: string) => void }): void {
  const now = Date.now();
  if (now - lastWarnAt >= WARN_INTERVAL_MS) {
    lastWarnAt = now;
    logger.warn(msg);
  }
}

/**
 * Resolve the canonical client IP for a Fastify request.
 *
 * Returns { ip, source } where source indicates how the IP was derived.
 * The socket peer is used as fallback (fails closed — unknown clients share
 * one bucket rather than getting fresh ones).
 */
export function getClientIp(request: FastifyRequest): ClientIpResult {
  const cfHeader = request.headers['cf-connecting-ip'];

  if (typeof cfHeader === 'string' && cfHeader.trim() !== '') {
    const candidate = cfHeader.trim();

    // Reject multi-value (comma-separated) — a single cf-connecting-ip is
    // always a single IP; multiple values indicate header spoofing.
    if (candidate.includes(',')) {
      maybeWarn(
        `[clientIp] cf-connecting-ip contains multiple values ("${candidate.slice(0, 40)}..."); falling back to socket`,
        request.log,
      );
      return socketFallback(request);
    }

    // Must be a valid IP address
    if (net.isIP(candidate) === 0) {
      maybeWarn(
        `[clientIp] cf-connecting-ip is not a valid IP ("${candidate.slice(0, 40)}"); falling back to socket`,
        request.log,
      );
      return socketFallback(request);
    }

    // Must not be a private/loopback/link-local/CGNAT address.
    // A valid public Cloudflare-forwarded IP is never in these ranges.
    if (isForbidden(candidate)) {
      maybeWarn(
        `[clientIp] cf-connecting-ip is a private/reserved address (${candidate}); falling back to socket`,
        request.log,
      );
      return socketFallback(request);
    }

    return { ip: candidate, source: 'cf-connecting-ip' };
  }

  // Header absent or an array (should not happen from Cloudflare, but be safe)
  if (process.env.NODE_ENV !== 'test') {
    maybeWarn(
      '[clientIp] cf-connecting-ip header missing or invalid; falling back to socket peer address',
      request.log,
    );
  }
  return socketFallback(request);
}

function socketFallback(request: FastifyRequest): ClientIpResult {
  // request.socket.remoteAddress is always the TCP peer (Render's internal proxy).
  // With trustProxy: false this is also what request.ip returns, but we use
  // socket directly to be explicit and avoid any future trustProxy confusion.
  const socketIp = request.socket?.remoteAddress ?? 'unknown';
  return { ip: socketIp, source: 'socket' };
}

/** Reset the warn throttle — only used in tests. */
export function resetWarnThrottleForTest(): void {
  lastWarnAt = 0;
}
