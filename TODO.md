# TODO.md — Verdict

## 🔴 Current Sprint (Production Hardening)
- [ ] **BYOK Step 1 — Provider Abstraction Layer:** In progress. `backend/src/providers/` layer built (types, openaiCompatible base, openai, xai, openrouter, anthropic, gemini adapters, registry, POST /api/providers/models route). Pino logger redaction configured + proven with 4-test suite. Gemini ✅ live-verified (38 vision models, exclusion filters confirmed). OpenRouter ✅ live-verified (211 vision models, input_modalities detection confirmed). OpenAI ✅ live-verified (18 vision models; false-positive transcribe/tts/search-preview models caught and fixed). **Anthropic code-complete, live-verification pending API key. xAI matches documented OpenAI-compatible spec, live-unverified — pending API key.** Task stays open until all 5 providers are verified against real /models endpoints.
- [ ] **BYOK Step 2a — critique() integration:** Done. All 5 providers implemented. Audit flow successfully wired through the BYOK layer. Live-verified using Gemini default and OpenAI BYOK (JSON schema parsing works). `lib/gemini.ts` deleted. OpenRouter `critique()` path is code-complete, error-handling paths (402/429/504) all confirmed live against real OpenRouter responses; a full successful completion is currently blocked by free-tier model availability, not a known code defect — revisit opportunistically.
  - **Pending Verification Commands (run when keys available):**
    ```powershell
    # Anthropic /models test
    Invoke-RestMethod -Uri "http://localhost:3001/api/providers/models" -Method Post -ContentType "application/json" -Body '{"provider": "anthropic", "apiKey": "YOUR_ANTHROPIC_KEY"}'
    
    # xAI /models test
    Invoke-RestMethod -Uri "http://localhost:3001/api/providers/models" -Method Post -ContentType "application/json" -Body '{"provider": "xai", "apiKey": "YOUR_XAI_KEY"}'
    ```
- [ ] **Plain-Language Error Handling:** Translate internal failures (TIMEOUT, BLOCKED, AI_RATE_LIMIT, etc.) into user-readable messages. Specifically show exact reset timestamp on rate-limit hits and offer BYOK as a fallback.
- [ ] **Full Visual/UX Design Pass:** Execute a comprehensive frontend design overhaul using the `frontend-design` skill.
- [ ] **Backlog Review:** Evaluate every existing deferred item (orphaned job recovery, 0-findings vs. critique-failed, competitor comparison, etc.) to explicitly decide what's in-scope for this phase vs future work.
- [ ] **Security Review Pass:** Run a structured OWASP-style review (injection, hardcoded secrets, auth gaps, CORS, insecure deserialization) as an explicitly instructed task.
- [ ] **Full End-to-End Re-test:** Re-verify all systems before deployment.
- [ ] **Deployment:** Check Koyeb verification status. If cleared, deploy backend to Koyeb and frontend to Vercel.

## 🟡 Up Next (After Current Sprint)
- (none — MVP features complete)

## 🟢 Backlog (Future)
- [ ] Competitor comparison mode (side-by-side)
- [ ] Historical tracking / re-run comparison
- [ ] Full bounding-box overlays for every finding
- [ ] Auto-generated before/after mockup for top visual issue
- [ ] PDF export
- [ ] DOM snapshot capture — deferred, not in MVP scope; requires revisiting Task 5's capture module if ever needed
- [ ] Orphaned job recovery — if the server restarts/crashes while an AuditJob is pending or running, it has no path to failed/retry with the current in-process queue; not handled in MVP, would need persistent job state or a startup reconciliation pass if revisited.
- [ ] Distinguish '0 findings' from 'critique failed' in the API response — currently indistinguishable, empty array either way; would need a stored status/error field per agent result if surfaced to the UI later.
- [ ] Explicit request-level timeout on provider `critique()` calls — currently relying on default fetch/SDK behavior. Given the single in-process Playwright job queue on free-tier hosting, a hung upstream call (like seen with OpenRouter) risks blocking the one available worker slot for all pending audits.
- [ ] BYOK provider badge on `Report.tsx` currently only persists via React Router state — disappears on hard refresh or shared link. If this matters later, would need a non-sensitive `byokProviderUsed` column on `AuditJob` (provider name only, never the key) — small, low-risk addition, just deliberately out of scope for Step 2b.

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
- [x] Supabase Storage upload wiring for screenshots — Session 9, 2026-07-26
- [x] Report UI (score, category breakdown, ranked action items, annotated screenshot) — Session 9, 2026-07-26
- [x] Landing page + failure-state UI — Session 9, 2026-07-26
- [x] GitHub Actions Supabase keepalive cron (every 3 days) — Session 9, 2026-07-26

## 🐛 Known Bugs
- **AXE_FAILED bails entire capture:** `AXE_FAILED` currently bails out of the entire `captureUrl` function in `session.ts`, discarding valid screenshots/Web Vitals data and failing the whole audit over a CSP issue with axe-core injection alone. Should degrade to a partial state (empty accessibility findings) instead of a fatal failure. Not fixed in this pass — flagged during Task 2 (plain-language error handling), scoped separately.
- **OpenRouter Model Filter:** `google/lyria-3-pro-preview` has `image` in `architecture.input_modalities`, so it passes our `supportsVision` filter. However, it's an audio/music generation model (`output_modalities` includes `audio`), which causes downstream `json_object` parsing failures (returns lyrics instead of JSON). We need an explicit non-chat-model exclusion for OpenRouter.

## 💡 Ideas / Notes
- Antigravity CLI supports async subagents — consider dispatching frontend UI work to a background subagent while the capture/agents pipeline is built in the foreground, once there's enough surface area to parallelize.
- Custom global skills (fast-search, code-audit, ui-ux) from the original setup plan aren't installed yet — only the built-in `antigravity-guide` skill is loaded. Worth setting up in a later session, not blocking now.
- **Render build command must include `npx playwright install chromium`** — Chromium is not bundled in the npm package; it must be installed separately on each Render build. Add this to the build script when deploying.
