import './env.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

import fastifyCookie from '@fastify/cookie';
import auditsRoutes from './routes/audits.js';
import providersRoutes from './routes/providers.js';
import { db } from './db/client.js';
import { auditJob } from './db/schema.js';
import { eq } from 'drizzle-orm';

async function reconcileOrphanedJobs() {
  try {
    const orphaned = await db.update(auditJob)
      .set({ 
        status: 'failed', 
        failureReason: 'Server restarted while job was in progress. Job orphaned.',
        completedAt: new Date()
      })
      .where(eq(auditJob.status, 'running'))
      .returning();
      
    if (orphaned.length > 0) {
      console.log(`[Reconciliation] Marked ${orphaned.length} orphaned jobs as failed.`);
    }
  } catch (error) {
    console.error('[Reconciliation] Failed to clean up orphaned jobs:', error);
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
  await reconcileOrphanedJobs();
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
