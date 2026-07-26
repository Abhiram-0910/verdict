# AGENTS.md — Session Handoff Log

## Project State
**Last updated:** 2026-07-25
**Current branch:** main
**Overall status:** Task 8 (DB write wired to capture module) complete. session.ts successfully persists to Postgres.

---

## Session Log

### Session 0 — 2026-07-24 (Planning)
**Goal:** Define architecture, failure audit, master task list, and initial project docs for Verdict.

**Completed:**
- [x] Full architecture decided: single Node/Fastify runtime, single Playwright session for capture+metrics+accessibility, Cloud Run/Vercel/Supabase/R2 hosting stack
- [x] Failure audit written (demo-time risks + prevention + backups)
- [x] 22-task master build list with executor/time/dependencies
- [x] CLAUDE.md, ARCHITECTURE.md, TODO.md, AGENTS.md drafted

**Decisions made:**
- Single Playwright session replaces the spec's separate Lighthouse-equivalent tool — halves per-audit compute, keeps more audits inside Cloud Run's free tier
- Single Node/TypeScript runtime replaces the spec's suggested FastAPI backend — avoids a cross-language split with no benefit on a solo project
- Sonnet selected as the build model for Antigravity — task complexity is standard engineering, not deep architectural reasoning
- "Lifetime free" clarified as: $0 to any visitor, capped/bounded cost to Abhi via a monthly Anthropic spend cap — not literally $0 across the whole stack

**Problems encountered:**
- `agy inspect` confirms only the built-in `antigravity-guide` skill is currently loaded — the custom global skills (fast-search, code-audit, ui-ux) from the original setup plan haven't been installed yet

---

### Session 1 — 2026-07-25 (Task 2 Scaffolding & Stack Revision)
**Goal:** Create root project documentation, scaffold independent Fastify+TS backend and React+Vite frontend, and update architecture for card-free hosting stack.

**Completed:**
- [x] Created `CLAUDE.md`, `ARCHITECTURE.md`, `TODO.md`, `AGENTS.md`, `.gitignore`, and `.env.example` at root.
- [x] Scaffolded `backend/` workspace (Fastify, TypeScript, tsx, CORS, zod, health endpoint).
- [x] Scaffolded `frontend/` workspace (Vite, React, TypeScript, Tailwind CSS, Lucide icons).
- [x] Typechecked (`npm run typecheck`) and built (`npm run build`) both workspaces cleanly.
- [x] Booted and verified both dev servers (`backend` on `:3001` with `/health` returning 200 OK, `frontend` on `:3000` returning 200 OK HTML payload).
- [x] Updated stack architecture: replaced Anthropic with Gemini API (`gemini-2.5-flash`), Google Cloud Run with Render.com free web service, and Cloudflare R2 with Supabase Storage. Deciding constraint was card-free hosting and zero-cost setup.

**Decisions made:**
- Used npm explicitly in both workspaces.
- Kept workspaces strictly independent (no shared root `node_modules` or monorepo tools).
- Switched AI provider to Google AI Studio Gemini API (`gemini-2.5-flash`) with graceful 429 rate limit handling.
- Switched backend host to Render.com free tier (noted 512MB RAM ceiling requiring single Playwright concurrency queue and 15-min idle sleep).
- Switched storage to Supabase Storage (single bucket alongside Postgres DB).

**Next session should start with:**
- Playwright capture module in `backend/src/capture/session.ts` (desktop + mobile screenshots + Web Vitals CDP injection).

---

### Session 2 — 2026-07-25 (Task 5: Capture Module)
**Goal:** Build `backend/src/capture/session.ts` and `backend/src/capture/queue.ts`.

**Completed:**
- [x] Installed `playwright` and `@supabase/supabase-js` in `backend/`.
- [x] Installed Chromium browser via `npx playwright install chromium`.
- [x] Added `"DOM"` to `backend/tsconfig.json` lib (required for Playwright evaluate callbacks).
- [x] Created `backend/src/capture/queue.ts` — in-process FIFO queue, single concurrency, `enqueue()` + `queueDepth()` exported.
- [x] Created `backend/src/capture/session.ts` — full capture pipeline: desktop screenshot (1440×900), mobile screenshot (375×812), Web Vitals via PerformanceObserver `addInitScript`, axe-core via CDN, `document.fonts.ready` settle with 3s cap.
- [x] `npm run typecheck` passes with 0 errors.

**Decisions made:**
- `document.fonts.ready` settle (capped at 3s) replaces flat delay — directly addresses font-load race condition from the original failure audit.
- `CaptureSuccess` includes `partial: boolean` and `partialReason: string | null` — a page that loaded but missed the fonts deadline is a success with a caveat, not a third state.
- PerformanceObserver injected via `page.addInitScript(string)` (not a function) to avoid TypeScript DOM-vs-Node type conflicts in the serialised browser context.
- axe-core loaded from CDN (versioned URL). Known limitation: pages with strict CSP blocking external scripts will produce `AXE_FAILED`. Future fix: inline bundle via `page.addScriptTag({ content })`.
- DB writes (`CaptureResult`, `AccessibilityFinding` rows) intentionally excluded — clean boundary; caller handles persistence once Task 7 schema exists.

**Problems encountered / notes:**
- Render build command must include `npx playwright install chromium` — Chromium is not bundled in the npm package. Noted in TODO.md.
- axe-core initially used a CDN URL; replaced with `npm install axe-core` + `page.addScriptTag({ content })` reading `axe.min.js` from `node_modules`. CDN approach removed a lockfile pin and added a live uptime dependency to every audit.
- `createRequire(import.meta.url)` failed under NodeNext CJS output; resolved with `path.join(__dirname, ...)` which is correct for both `tsx` dev and compiled `dist/` contexts.
- `.gitignore` confirmed: `.env` is explicitly listed on line 15 — verified before any credentials go into the file.

**Next session should start with:**
- Postgres schema (Task 7): `AuditJob`, `CaptureResult`, `AccessibilityFinding`, `VisualFinding`, `CopyFinding`, `AuditScore`, `ActionItem` tables + Supabase DB client in `backend/src/db/`.

---

### Session 3 — 2026-07-25 (Task 7: Postgres Schema + DB Client)
**Goal:** Build `backend/src/db/schema.ts` and `backend/src/db/client.ts` using Drizzle ORM.

**Completed:**
- [x] Installed `drizzle-orm`, `postgres` driver, and `drizzle-kit` dev dependency.
- [x] Created `backend/src/db/schema.ts` defining all 7 tables per `ARCHITECTURE.md`.
- [x] Created `backend/src/db/client.ts` implementing a singleton connection.
- [x] Configured `backend/drizzle.config.ts` for drizzle-kit migrations.
- [x] Added `db:generate`, `db:push`, and `db:studio` scripts to `package.json`.
- [x] Corrected `ARCHITECTURE.md` (removed nonexistent DOM snapshot field, added DB migrations docs).
- [x] Pushed DOM snapshot requirement to backlog in `TODO.md`.

**Decisions made:**
- Used `numeric(6,4)` for CLS score to avoid float precision issues and keep standard semantics.
- Used `pgEnum` for `AuditJob.status` to enforce consistency.
- Used polymorphic reference `findingType` and `findingId` in `ActionItem` table rather than three nullable FKs.
- `CaptureResult` mirrors `CaptureSuccess` from `session.ts` exactly without direct type import to avoid circular dependencies.

**Next session should start with:**
- Task 7 is complete, but `session.ts` hasn't been wired to write to the DB yet. The next step is wiring the DB into `session.ts` or building the async job orchestration endpoint (which creates the AuditJob).

---

### Session 4 — 2026-07-25 (Task 8: DB Write Stub)
**Goal:** Wire `session.ts`'s `captureUrl()` to persist `CaptureResult` and `AccessibilityFinding` rows using the new Postgres schema.

**Completed:**
- [x] Imported DB client and Drizzle schema into `session.ts`.
- [x] Wrapped DB writes in a strict `await db.transaction(async (tx) => { ... })` block in `captureUrl()`.
- [x] Handled DB write failures gracefully by adding `DB_WRITE_FAILED` to `CaptureFailure`.
- [x] Added `capturedData?: CaptureSuccess` to the failure object so the caller doesn't lose expensive Playwright data if only the persistence step fails.
- [x] Tested with `npm run typecheck` (0 errors).

**Decisions made:**
- Skipping the `accessibility_finding` insert completely if there are 0 violations (no empty DB requests).
- Drizzle's `numeric(6,4)` representation requires `cls` to be converted to a string before inserting, handled inline via `.toString()`.

**Next session should start with:**
- Building the async job orchestration routes (`/api/audits`) to handle the top-level `AuditJob` creation and kickoff.

---

### Session 5 — 2026-07-25 (Task 12: Orchestration & Rate Limiting)
**Goal:** Build `backend/src/routes/audits.ts` for async job execution and `backend/src/lib/rateLimit.ts` for cookie-based limits.

**Completed:**
- [x] Restored `enqueue` wrapping inside `session.ts` via an exported `runQueuedCapture` function. This structurally enforces the single-concurrency queue so callers don't have to remember to wrap captures.
- [x] Added `TODO.md` Backlog note for orphaned job recovery.
- [x] Implemented `rateLimit.ts` (using `@fastify/cookie`) validating a 24-hour window constraint (`RATE_LIMIT_FREE_AUDITS_PER_DAY=5`). Fixed live-tested URI-decoding bug (`JSON.parse` failing on URL-encoded JSON cookies) and `resetAt` initialization bug.
- [x] Implemented `POST /api/audits` checking constraints, enqueuing the background process via Zod/DB, and immediately returning `202 Accepted` with ID. Wrapped detached promise thoroughly traps execution/DB failures to transition rows to `failed`.
- [x] Implemented `GET /api/audits/:id` utilizing Zod UUID validation (blocking bad input to Postgres) and cleanly joining `AuditJob` to `CaptureResult`/`AccessibilityFinding`.
- [x] Solved an ES-module loader bug (`DATABASE_URL is not set`) affecting the dev server by injecting `--env-file=../.env` natively into `package.json` scripts rather than relying entirely on `dotenv.config()` placement.
- [x] Verified full end-to-end operation against real Supabase DB via Node test script (`test-api.ts`), successfully witnessing `pending -> running -> complete` and `429 Too Many Requests` state transitions.

**Next session should start with:**
- Task 14: Integrating Supabase Storage upload wiring for screenshots. Or beginning to work on the visual critique agent.

---

### Session 6 — 2026-07-26 (Tasks 9 & 10: Visual & Copy Critique Agents)
**Goal:** Build `visualCritique.ts` and `copyCritique.ts` to parse screenshots and text using Gemini.

**Completed:**
- [x] Implemented `visualCritique.ts` (Vision multimodal) and `copyCritique.ts` (Text) using the `@google/genai` SDK.
- [x] Configured structured JSON outputs with strict Zod validation.
- [x] Implemented robust 429 retry backoff logic in `lib/gemini.ts`.
- [x] Handled DB writes directly within the agents, persisting to `visual_finding` and `copy_finding` tables.
- [x] Implemented discriminated union returns (explicitly typed failures, no silent empty-array fallbacks).
- [x] Adjusted model to `gemini-3.1-flash-lite` due to active 404 incidents on 2.5-flash and the sunset of 2.0-flash.
- [x] Verified full end-to-end success path against real DB inputs.

**Decisions made:**
- **Zod Schema Relaxation**: Changed Zod schema for `screenshotRegion` to `.partial()`. This relaxes the requirement for all keys (`x`, `y`, `width`, `height`) to be present (allowing the model to just return `x` and `y` without failing the whole payload), but **does not** silently coerce types. For example, if `x` is returned as a string `"200"`, it will still correctly fail validation because `z.number()` is strictly typed. This relaxation was necessary because the model occasionally omits the full bounding box when assessing high-level UI findings.
- **Model Update**: Updated targets from the deprecated/broken 2.x versions to the current-generation `gemini-3.1-flash-lite`.

**Next session should start with:**
- Task 14 (Supabase Storage upload wiring) or Task 11 (Scoring & Report Agent).

---

### Session 7 — 2026-07-26 (Task: Orchestration Wiring)
**Goal:** Wire `visualCritique` and `copyCritique` into the background job in `audits.ts` after capture succeeds.

**Completed:**
- [x] Updated `audits.ts` POST route: `runQueuedCapture` now invokes `runVisualCritique` and `runCopyCritique` concurrently via `Promise.all` upon a successful (or partial) capture.
- [x] Wrapped agent calls in individual `.catch()` handlers so an unexpected exception in one agent won't fail the entire job.
- [x] Defined and implemented the partial/failure philosophy: if an agent fails (e.g. rate limited, malformed output), the `AuditJob` still safely reaches `complete` (with whatever valid data exists), preventing the loss of expensive capture data.
- [x] Updated `audits.ts` GET route to select and attach `visualFindings` and `copyFindings` to the returned API response.
- [x] Added Backlog item to `TODO.md` regarding distinguishing '0 findings' from 'critique failed' in the GET response.
- [x] Successfully verified end-to-end integration via `test-e2e.ts`.

**Next session should start with:**
- Task 11 (Scoring & Report Agent) or UI integration.

---

### Session 8 — 2026-07-26 (Task 11: Scoring & Report Agent)
**Goal:** Build `scoring.ts` to deterministically calculate category/overall scores and impact-rank all findings into `ActionItem` rows.

**Completed:**
- [x] Implemented deterministic scoring algorithm in `backend/src/agents/scoring.ts` (0-100 per category, dynamically re-weighting Performance if Web Vitals are null).
- [x] Implemented `ActionItem` generation with strict cross-category impact ranking (e.g. `Visual: high` at weight 100 outranks `Accessibility: critical` at weight 90). Cap at top 20 items.
- [x] Updated `schema.ts` to explicitly allow `null` for the overall score and breakdown fields, representing an agent failure rather than defaulting to a false 100/100. Pushed via `npx drizzle-kit push --force` with explicit user approval.
- [x] Wired `runScoring` into `audits.ts` background orchestration and updated the GET route to attach `auditScore` and `actionItems`.
- [x] Verified full end-to-end operation with a real capture, returning a fully populated and ranked API response.

**Next session should start with:**
- Task 14 (Supabase Storage upload wiring) or Report UI.

