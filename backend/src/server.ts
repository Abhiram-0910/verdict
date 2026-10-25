import './env.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyCookie from '@fastify/cookie';
import auditsRoutes from './routes/audits.js';
import providersRoutes from './routes/providers.js';
import { db } from './db/client.js';
import { auditJob } from './db/schema.js';
import { eq, and, lt, or, sql } from 'drizzle-orm';
import { getGlobalEgressProxy } from './capture/egressProxy.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

export function logFatalAndExit(type: 'uncaughtException' | 'unhandledRejection', err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  
  // Clean any potential secret patterns just in case
  const safeMessage = message.replace(/((?:key|secret|token|password|auth|apiKey|byokApiKey)=)[^\s&]+/gi, '$1[REDACTED]');
  const safeStack = stack ? stack.replace(/((?:key|secret|token|password|auth|apiKey|byokApiKey)=)[^\s&]+/gi, '$1[REDACTED]') : undefined;

  const logPayload = JSON.stringify({
    level: 'fatal',
    type,
    message: safeMessage,
    stack: safeStack,
    timestamp: new Date().toISOString(),
  });

  process.stderr.write(logPayload + '\n', () => {
    process.exit(1);
  });
  // Force exit after 1s if stream didn't flush
  setTimeout(() => process.exit(1), 1000).unref();
}

if (process.env.NODE_ENV !== 'test') {
  process.on('uncaughtException', (err) => {
    logFatalAndExit('uncaughtException', err);
  });

  process.on('unhandledRejection', (reason) => {
    logFatalAndExit('unhandledRejection', reason);
  });
}

export async function reconcileOrphanedJobs(now = new Date()) {
  try {
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    // 1. Mark pending jobs older than 10 minutes as failed
    const pendingOrphaned = await db.update(auditJob)
      .set({ 
        status: 'failed', 
        failureReason: 'SERVER_RESTART',
        completedAt: now
      })
      .where(and(
        eq(auditJob.status, 'pending'),
        lt(auditJob.createdAt, tenMinutesAgo)
      ))
      .returning();

    // 2. Mark running jobs older than 5 minutes as failed
    const runningOrphaned = await db.update(auditJob)
      .set({ 
        status: 'failed', 
        failureReason: 'SERVER_RESTART',
        completedAt: now
      })
      .where(and(
        eq(auditJob.status, 'running'),
        or(
          lt(auditJob.startedAt, fiveMinutesAgo),
          and(sql`${auditJob.startedAt} IS NULL`, lt(auditJob.createdAt, fiveMinutesAgo))
        )
      ))
      .returning();
      
    const total = pendingOrphaned.length + runningOrphaned.length;
    if (total > 0) {
      console.log(`[Reconciliation] Marked ${total} orphaned jobs (${pendingOrphaned.length} pending >10m, ${runningOrphaned.length} running >5m) as failed.`);
    }
    return { pendingOrphaned, runningOrphaned };
  } catch (error) {
    console.error('[Reconciliation] Failed to clean up orphaned jobs:', error);
    return { pendingOrphaned: [], runningOrphaned: [] };
  }
}

export async function buildServer() {
  const app = Fastify({
    trustProxy: true,
    logger: {
      // Redact apiKey fields so they can never appear in log lines,
      // regardless of which route or handler logs the request body.
      // Both field names are covered: the general 'apiKey' and the
      // explicit 'byokApiKey' used in future BYOK audit submissions.
      redact: {
        paths: ['req.body.apiKey', 'req.body.byokApiKey'],
        censor: '[REDACTED]',
      },
    },
  });

  const frontendUrlRaw = process.env.FRONTEND_URL || 'http://localhost:3000';
  const frontendUrl = frontendUrlRaw.endsWith('/') ? frontendUrlRaw.slice(0, -1) : frontendUrlRaw;

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || origin === frontendUrl || origin === 'http://127.0.0.1:3000') {
        cb(null, true);
        return;
      }
      cb(new Error("Not allowed"), false);
    },
    credentials: true,
  });

  await app.register(fastifyCookie, {
    secret: process.env.COOKIE_SECRET || 'verdict-secret-placeholder',
    parseOptions: {}
  });

  await app.register(auditsRoutes);
  await app.register(providersRoutes);

  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  return app;
}

async function main() {
  await getGlobalEgressProxy();
  await reconcileOrphanedJobs();
  setInterval(() => {
    reconcileOrphanedJobs();
  }, 5 * 60 * 1000).unref();

  const server = await buildServer();

  try {
    await server.listen({ port: PORT, host: HOST });
    console.log(`[Verdict Backend] Server running on http://${HOST}:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  main();
}
