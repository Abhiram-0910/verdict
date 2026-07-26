import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { db, auditJob, captureResult, accessibilityFinding, visualFinding, copyFinding, auditScore, actionItem } from '../db/index.js';
import { runQueuedCapture } from '../capture/session.js';
import { runVisualCritique } from '../agents/visualCritique.js';
import { runCopyCritique } from '../agents/copyCritique.js';
import { runScoring } from '../agents/scoring.js';
import { checkAndConsumeRateLimit } from '../lib/rateLimit.js';

const submitSchema = z.object({
  url: z.string().url(),
});

const idSchema = z.string().uuid();

export default async function auditsRoutes(fastify: FastifyInstance) {
  fastify.post('/api/audits', async (request, reply) => {
    // 1. Rate Limit Check
    if (!checkAndConsumeRateLimit(request, reply)) {
      return reply.status(429).send({
        error: 'Rate limit exceeded',
        detail: 'You have reached the maximum number of free audits for today.',
      });
    }

    // 2. Input Validation
    const parsed = submitSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Bad Request',
        detail: 'Invalid URL provided.',
      });
    }
    const { url } = parsed.data;

    // 3. Create AuditJob
    const [job] = await db.insert(auditJob).values({
      url,
      status: 'pending',
    }).returning({ id: auditJob.id });

    // 4. Enqueue background task
    // (Detached promise — we don't await this here, we return 202 immediately)
    runQueuedCapture(url, job.id).then(async (result) => {
      if (result.error) {
        if (result.reason === 'DB_WRITE_FAILED') {
          console.error(`[Job ${job.id}] DB_WRITE_FAILED with capturedData:`, result.capturedData);
        }
        await db.update(auditJob).set({
          status: 'failed',
          failureReason: result.detail,
          completedAt: sql`now()`,
        }).where(eq(auditJob.id, job.id));
      } else {
        // Run AI critiques concurrently (they handle their own DB persistence)
        // Wrap each in a broad catch so an unexpected crash in one doesn't fail the whole job
        const [visualResult, copyResult] = await Promise.all([
          runVisualCritique(job.id, result.desktopScreenshotUrl).catch((err) => {
            console.error(`[Job ${job.id}] Unhandled crash in visualCritique:`, err);
            return { success: false, reason: 'UNKNOWN', detail: String(err) } as const;
          }),
          runCopyCritique(job.id, result.renderedText).catch((err) => {
            console.error(`[Job ${job.id}] Unhandled crash in copyCritique:`, err);
            return { success: false, reason: 'UNKNOWN', detail: String(err) } as const;
          }),
        ]);

        // Run Scoring deterministically based on collected findings
        await runScoring(job.id, {
          visualSuccess: visualResult.success,
          copySuccess: copyResult.success,
        }).catch((err) => {
          console.error(`[Job ${job.id}] Unhandled crash in scoring:`, err);
        });

        await db.update(auditJob).set({
          status: 'complete',
          completedAt: sql`now()`,
        }).where(eq(auditJob.id, job.id));
      }
    }).catch(async (err) => {
      // Catch any unexpected unhandled errors (e.g. initial DB update failure)
      console.error(`[Job ${job.id}] Untrapped error in runQueuedCapture:`, err);
      await db.update(auditJob).set({
        status: 'failed',
        failureReason: err instanceof Error ? err.message : String(err),
        completedAt: sql`now()`,
      }).where(eq(auditJob.id, job.id));
    });

    // 5. Respond immediately
    return reply.status(202).send({ id: job.id });
  });

  fastify.get('/api/audits/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      return reply.status(400).send({ error: 'Bad Request', detail: 'Invalid ID format.' });
    }

    const [job] = await db.select().from(auditJob).where(eq(auditJob.id, id));
    if (!job) {
      return reply.status(404).send({ error: 'Not Found', detail: 'AuditJob not found.' });
    }

    if (job.status !== 'complete') {
      return reply.send({ job });
    }

    const [capture] = await db.select().from(captureResult).where(eq(captureResult.auditJobId, id));
    const axes = await db.select().from(accessibilityFinding).where(eq(accessibilityFinding.auditJobId, id));
    const visuals = await db.select().from(visualFinding).where(eq(visualFinding.auditJobId, id));
    const copies = await db.select().from(copyFinding).where(eq(copyFinding.auditJobId, id));
    const [score] = await db.select().from(auditScore).where(eq(auditScore.auditJobId, id));
    const items = await db.select().from(actionItem).where(eq(actionItem.auditJobId, id));

    return reply.send({
      job,
      captureResult: capture || null,
      auditScore: score || null,
      accessibilityFindings: axes,
      visualFindings: visuals,
      copyFindings: copies,
      actionItems: items,
    });
  });
}
