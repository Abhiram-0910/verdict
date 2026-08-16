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
- [x] **Plain-Language Error Handling:** Done. Translated internal failures (TIMEOUT, BLOCKED, AI_RATE_LIMIT, etc.) into user-readable messages. Shows exact reset timestamp on rate-limit hits and offers BYOK as a fallback. Verified with 4-item test round (capture-timeout, malformed-AI, live rate-limit UI, mixed-agent-failure).
- [x] **Full Visual/UX Design Pass:** Done. Bounding box overlay logic fully implemented over the desktop screenshot, with bi-directional hover states using the token system. Handled the desktop-image race condition in Playwright.
- [x] **Backlog Review:** Done. Three backlog items promoted to fixes (AXE_FAILED degradation, OpenRouter output_modalities filter, critique() timeout). Doc drift resolved. Remaining items triaged as genuine future work.
- [x] **Security Review Pass:** Done. Full OWASP-style review executed. Discovered and fixed two critical vulnerabilities: (1) SSRF bypass allowing capture of internal/cloud-metadata via headless browser; fixed with strict DNS-level `page.route` network interception blocking RFC1918, CGNAT, and IPv6 loopback variants, and (2) rate limiter bypass via cookie deletion; fixed with server-side double-enforcement combining the existing `deviceId` cookie with an in-memory IP bucket powered by `trustProxy: true`. Both verified via live tests.
- [x] **Full End-to-End Re-test:** Done. All 7 tests in `backend/tests/e2e-final.ts` passed successfully. Included fixes for UI strict mode locators and correct backend rate-limiter cleanup between test suites.
- [ ] **Deployment:** Check Koyeb verification status. If cleared, deploy backend to Koyeb and frontend to Vercel.
  - **Post-Deployment Verification:** Once live on Koyeb, confirm `trustProxy: true` securely derives `request.ip` from Koyeb's edge-set `X-Forwarded-For` and ignores client-spoofed headers. Test by sending a request with a forged `X-Forwarded-For` header directly against the live URL to ensure it has no effect on the observed rate-limiting IP.

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
- [x] Explicit request-level timeout on provider `critique()` calls — FIXED (Session 17): AbortController added to openaiCompatible base class; Anthropic and Gemini adapters use their own SDK-level timeout param. Mapped to `TIMEOUT` reason code, consistent with capture-layer taxonomy.
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
- [x] Supabase keepalive fixed — Session 14, 2026-08-08. Switched from raw Postgres SELECT 1 (3-day) to daily REST API ping (`/rest/v1/audit_job?limit=1`) using anon key. Service key removed from workflow.
- [x] Distinguish '0 findings' from 'critique failed' — Session 13/16. Task 2 added `visualStatus`/`copyStatus` columns; Report.tsx renders distinct FAILED vs N/A states.
- [x] AXE_FAILED bails entire capture — FIXED (Session 17): axe injection failure now degrades to empty `accessibilityFindings` with `partial: true`, screenshots and Web Vitals still saved.
- [x] OpenRouter vision filter (lyria-3-pro-preview false positive) — FIXED (Session 17): added `output_modalities` must-include-text check on top of existing `input_modalities` image check. Live-verified excluded.

## 🐛 Known Bugs
- (none — all known bugs resolved as of Session 17)

## ⚠️ Render Deployment Lessons Learned (Session 20)
- **PUT /env-vars is destructive:** Render's `PUT /services/:id/env-vars` replaces the *entire* env var list with whatever you send. Always `GET /env-vars` first, merge the new key into the existing list, then `PUT` the merged result. Sending a partial list silently deletes all omitted keys — caused a production outage when `DATABASE_URL` and all Supabase/Gemini keys were wiped.
- **buildCommand cannot be set via the API on manually-created services:** `PATCH /services/:id` with `serviceDetails.buildCommand` returns HTTP 200 but a subsequent GET shows the old value unchanged. The Render dashboard Settings → Build Command field is the only reliable path for this specific field on services originally created via the "New Web Service" UI (not via a Blueprint/render.yaml sync).
- **render.yaml envVars/buildCommand is silently ignored for manually-created services:** Changes to `render.yaml` only apply to Blueprint-synced services. For manually-created services, all config changes must go through the dashboard UI or API directly.
- **`--with-deps` is broken on Render's native (non-Docker) build environment:** `npx playwright install --with-deps chromium` calls `apt-get` and requires root, which Render's native Node build environment does not provide. It causes a build failure. The correct command is `npx playwright install chromium` (no `--with-deps`) — Render's base image already includes the required OS libraries (libnss, libatk, etc.), proven by successful `chromium.launch()` once the binary was found. **Do not add `--with-deps` here.**

## 💡 Ideas / Notes
- Antigravity CLI supports async subagents — consider dispatching frontend UI work to a background subagent while the capture/agents pipeline is built in the foreground, once there's enough surface area to parallelize.
- Custom global skills (fast-search, code-audit, ui-ux) from the original setup plan aren't installed yet — only the built-in `antigravity-guide` skill is loaded. Worth setting up in a later session, not blocking now.
- **Render build command:** `npm install && npm run build && npx playwright install chromium` — the plain form (no `--with-deps`) is correct and sufficient. Render's native build image already includes the required OS libraries. `--with-deps` calls `apt-get` and requires root, which Render's native environment does not allow; it causes a build failure. Set this via the **Render dashboard Settings UI** only (API PATCH and render.yaml are both ignored for this manually-created service).
- **Render keepalive:** Deliberately no Render keepalive - cold starts accepted as a tradeoff, mitigated with a distinct loading message rather than eliminated, to avoid burning the shared 750-hour pool across other services on the account.
