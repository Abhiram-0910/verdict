import './env.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

import fastifyCookie from '@fastify/cookie';
import auditsRoutes from './routes/audits.js';
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
    logger: true,
  });

  const frontendUrlRaw = process.env.FRONTEND_URL || 'http://localhost:3000';
  const frontendUrl = frontendUrlRaw.endsWith('/') ? frontendUrlRaw.slice(0, -1) : frontendUrlRaw;

  await app.register(cors, {
    origin: frontendUrl,
    credentials: true,
  });

  await app.register(fastifyCookie, {
    secret: process.env.COOKIE_SECRET || 'verdict-secret-placeholder',
    parseOptions: {}
  });

  await app.register(auditsRoutes);

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
