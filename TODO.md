# TODO.md — Verdict

## 🔴 Current Sprint (Do This Now)
- [x] Scaffold Fastify+TS backend and React+Vite frontend in C:\Projects\verdict
- [x] Playwright capture module: desktop + mobile screenshot, Web Vitals via CDP injection
- [x] axe-core injection into the same Playwright session

## 🟡 Up Next (After Current Sprint)
- [ ] Supabase Storage upload wiring for screenshots
- [ ] Report UI (score, category breakdown, ranked action items, annotated screenshot)
- [ ] Landing page + failure-state UI
- [ ] Deploy backend to Render, deploy frontend to Vercel
- [ ] GitHub Actions Supabase keepalive cron (every 3 days — beats 7-day auto-pause window with margin)

## 🟢 Backlog (Future)
- [ ] Competitor comparison mode (side-by-side)
- [ ] Historical tracking / re-run comparison
- [ ] Full bounding-box overlays for every finding
- [ ] Auto-generated before/after mockup for top visual issue
- [ ] PDF export
- [ ] DOM snapshot capture — deferred, not in MVP scope; requires revisiting Task 5's capture module if ever needed
- [ ] Orphaned job recovery — if the server restarts/crashes while an AuditJob is pending or running, it has no path to failed/retry with the current in-process queue; not handled in MVP, would need persistent job state or a startup reconciliation pass if revisited.
- [ ] Distinguish '0 findings' from 'critique failed' in the API response — currently indistinguishable, empty array either way; would need a stored status/error field per agent result if surfaced to the UI later.

## ✅ Completed
- [x] Architecture, failure audit, task list, and CLAUDE.md/ARCHITECTURE.md/TODO.md/AGENTS.md drafted — Session 0, 2026-07-24
- [x] Fastify+TS and React+Vite scaffolding complete & verified — Session 1, 2026-07-25
- [x] Stack revision: switched to Gemini API (gemini-2.5-flash), Render.com, and Supabase Storage — Session 1, 2026-07-25
- [x] Capture module (session.ts + queue.ts): screenshots, Web Vitals, axe-core, in-process queue — Session 2, 2026-07-25
- [x] axe-core swapped from CDN to npm dep (`axe-core` installed, injected via `page.addScriptTag({ content })`) — Session 2, 2026-07-25
- [x] Postgres schema (AuditJob, CaptureResult, AccessibilityFinding, VisualFinding, CopyFinding, AuditScore, ActionItem) + Supabase connection via Drizzle ORM — Session 3, 2026-07-25
- [x] Wire capture module (session.ts) to Postgres via Drizzle (Task 8) — Session 4, 2026-07-25
- [x] Async job orchestration API (POST /api/audits, GET /api/audits/:id) with background queue (Task 12) — Session 5, 2026-07-25
- [x] Cookie-based rate limiter implementation (Task 12) — Session 5, 2026-07-25
- [x] Visual Critique Agent & Copy Critique Agent (Tasks 9 & 10) built, robustly error-handled, and verified with gemini-3.1-flash-lite — Session 6, 2026-07-26
- [x] Scoring & Report Agent built with deterministic impact ranking (Task 11) — Session 8, 2026-07-26

## 🐛 Known Bugs
- (none yet — no code written)

## 💡 Ideas / Notes
- Antigravity CLI supports async subagents — consider dispatching frontend UI work to a background subagent while the capture/agents pipeline is built in the foreground, once there's enough surface area to parallelize.
- Custom global skills (fast-search, code-audit, ui-ux) from the original setup plan aren't installed yet — only the built-in `antigravity-guide` skill is loaded. Worth setting up in a later session, not blocking now.
- **Render build command must include `npx playwright install chromium`** — Chromium is not bundled in the npm package; it must be installed separately on each Render build. Add this to the build script when deploying.
