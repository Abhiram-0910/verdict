/**
 * db/schema.ts
 *
 * Drizzle ORM table definitions for all seven Verdict Postgres tables.
 * Mirrors the shape of CaptureSuccess in capture/session.ts (partial,
 * partialReason, screenshot URLs, Web Vitals) without importing from it —
 * that avoids a circular dependency if db/ is ever imported by capture/.
 *
 * Numeric columns (cls, confidence): Drizzle returns these as strings from
 * Postgres. Always call parseFloat() before arithmetic or comparisons.
 */

import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// ── Enums ────────────────────────────────────────────────────────────────────

export const auditJobStatusEnum = pgEnum('audit_job_status', [
  'pending',
  'running',
  'complete',
  'failed',
]);

/** TypeScript union mirroring the pgEnum — use this in application code. */
export type AuditJobStatus = (typeof auditJobStatusEnum.enumValues)[number];

export const agentStatusEnum = pgEnum('agent_status', [
  'pending',
  'complete',
  'failed'
]);

/** TypeScript union mirroring the agentStatusEnum — use this in application code. */
export type AgentStatus = (typeof agentStatusEnum.enumValues)[number];

// ── Tables ───────────────────────────────────────────────────────────────────

/**
 * One row per URL submission. Tracks the lifecycle of a full audit.
 * The frontend polls status via /api/audits/:id/status.
 */
export const auditJob = pgTable('audit_job', {
  id: uuid('id').primaryKey().defaultRandom(),
  url: text('url').notNull(),
  status: auditJobStatusEnum('status').notNull().default('pending'),
  visualStatus: agentStatusEnum('visual_status'),
  copyStatus: agentStatusEnum('copy_status'),
  /** Populated on hard failure — surface directly in the UI, never hide it. */
  failureReason: text('failure_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}).enableRLS();

/**
 * Raw output of the Playwright capture session for one audit.
 * Mirrors CaptureSuccess from capture/session.ts — one row per AuditJob.
 *
 * cls is stored as numeric(6,4) (e.g. 0.0512). Drizzle returns it as a
 * string; call parseFloat() before use. lcp is in milliseconds (integer).
 */
export const captureResult = pgTable('capture_result', {
  id: uuid('id').primaryKey().defaultRandom(),
  auditJobId: uuid('audit_job_id')
    .notNull()
    .references(() => auditJob.id, { onDelete: 'cascade' }),
  desktopScreenshotUrl: text('desktop_screenshot_url').notNull(),
  mobileScreenshotUrl: text('mobile_screenshot_url').notNull(),
  renderedText: text('rendered_text'),
  loadTimeMs: integer('load_time_ms').notNull(),
  /** Largest Contentful Paint in ms. NULL when not emitted (trivial pages). */
  lcp: integer('lcp'),
  /** Cumulative Layout Shift score 0.0000–9.9999. NULL when not observed. */
  cls: numeric('cls', { precision: 6, scale: 4 }),
  /** true when fonts didn't finish loading within the 3s cap. */
  partial: boolean('partial').notNull().default(false),
  partialReason: text('partial_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

/**
 * One row per axe-core violation found by the capture session.
 * Multiple rows per AuditJob (one per rule violation).
 */
export const accessibilityFinding = pgTable('accessibility_finding', {
  id: uuid('id').primaryKey().defaultRandom(),
  auditJobId: uuid('audit_job_id')
    .notNull()
    .references(() => auditJob.id, { onDelete: 'cascade' }),
  /** axe-core rule identifier, e.g. "color-contrast", "image-alt". */
  ruleId: text('rule_id').notNull(),
  /** minor | moderate | serious | critical */
  impact: varchar('impact', { length: 16 }).notNull(),
  description: text('description').notNull(),
  helpUrl: text('help_url').notNull(),
  /** Count of DOM nodes affected by this violation. */
  nodeCount: integer('node_count').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

/**
 * Visual hierarchy / layout finding from the Gemini Visual Critique Agent.
 * confidence and screenshotRegion carry the model's stated reasoning.
 */
export const visualFinding = pgTable('visual_finding', {
  id: uuid('id').primaryKey().defaultRandom(),
  auditJobId: uuid('audit_job_id')
    .notNull()
    .references(() => auditJob.id, { onDelete: 'cascade' }),
  /** e.g. hierarchy | clutter | cta_visibility | mobile_responsiveness */
  category: text('category').notNull(),
  description: text('description').notNull(),
  /** high | medium | low */
  severity: varchar('severity', { length: 16 }).notNull(),
  /**
   * Optional bounding box in pixels relative to the desktop screenshot.
   * { x, y, width, height }
   */
  screenshotRegion: jsonb('screenshot_region').$type<{
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  } | null>(),
  /** Model confidence 0.000–1.000. Drizzle returns as string — parseFloat() before use. */
  confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull(),
  /** The model's stated reasoning — required per CLAUDE.md preferred patterns. */
  reasoning: text('reasoning').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

/**
 * Messaging / CTA / trust-signal finding from the Gemini Copy Critique Agent.
 */
export const copyFinding = pgTable('copy_finding', {
  id: uuid('id').primaryKey().defaultRandom(),
  auditJobId: uuid('audit_job_id')
    .notNull()
    .references(() => auditJob.id, { onDelete: 'cascade' }),
  /** e.g. five_second | cta_copy | trust_signal */
  category: text('category').notNull(),
  description: text('description').notNull(),
  /** high | medium | low */
  severity: varchar('severity', { length: 16 }).notNull(),
  /** Model confidence 0.000–1.000. Drizzle returns as string — parseFloat() before use. */
  confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull(),
  reasoning: text('reasoning').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

/**
 * Aggregated score for one audit. Exactly one row per AuditJob (enforced
 * by the unique constraint on auditJobId).
 *
 * breakdown is a typed JSONB object — all four category scores are 0–100.
 */
export const auditScore = pgTable('audit_score', {
  id: uuid('id').primaryKey().defaultRandom(),
  auditJobId: uuid('audit_job_id')
    .notNull()
    .unique()
    .references(() => auditJob.id, { onDelete: 'cascade' }),
  /** Overall score 0–100 (weighted aggregate of breakdown categories). NULL if all categories fail. */
  overall: integer('overall'),
  /**
   * Per-category scores, each 0–100. NULL if the category failed.
   * { visual, copy, accessibility, performance }
   */
  breakdown: jsonb('breakdown')
    .$type<{
      visual: number | null;
      copy: number | null;
      accessibility: number | null;
      performance: number | null;
    }>()
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

/**
 * Ranked, concrete fix recommendations for one audit.
 * Uses a polymorphic reference (findingType + findingId) to point back at
 * the source finding rather than three nullable FK columns.
 *
 * rank=1 is the highest-estimated-impact item — ordered ascending in queries.
 */
export const actionItem = pgTable('action_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  auditJobId: uuid('audit_job_id')
    .notNull()
    .references(() => auditJob.id, { onDelete: 'cascade' }),
  /** 1 = highest impact. Ordered ascending when rendering the report. */
  rank: integer('rank').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  /** high | medium | low */
  estimatedImpact: varchar('estimated_impact', { length: 16 }).notNull(),
  /** Polymorphic: visual | copy | accessibility */
  findingType: varchar('finding_type', { length: 32 }).notNull(),
  /** UUID of the row in the finding table identified by findingType. */
  findingId: uuid('finding_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();
