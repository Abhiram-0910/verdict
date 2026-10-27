# ARCHITECTURE.md — Verdict

## Stack
| Layer | Technology | Why chosen |
|-------|-----------|------------|
| Frontend | React + Vite + Tailwind, deployed on Vercel (free tier) | Static SPA, no SSR needed; Vercel free tier never sleeps |
| Backend | Node.js + Fastify + TypeScript, single runtime | Playwright/axe-core are Node-native; avoids a Python/Node split for no benefit |
| Browser automation | Playwright (Chromium) — screenshot + Web Vitals + axe-core in one session | Half the compute of running Playwright + Lighthouse separately; matters on a free-tier compute budget |
| Backend hosting | Koyeb (free instance) | Replaced Render to avoid 750-hour pool limit; deployed via GHCR |
| Database | Supabase Postgres (free tier) | 500MB free forever; auto-pauses after 7 days idle — mitigated with weekly keepalive |
| Asset storage | Supabase Storage (free tier) | Integrated asset storage in the same Supabase project; single bucket for screenshots |
| AI | Google AI Studio Gemini API (Default) + BYOK Abstraction Layer | Currently uses Gemini free tier. Transitioning to a Bring-Your-Own-Key (BYOK) system supporting Gemini, OpenAI, Anthropic, Grok, and OpenRouter interchangeably. |
| Deployment domain | Free subdomains only (*.vercel.app, *.koyeb.app) | Custom domains skipped to keep the stack $0 |

---

## Folder Structure
```
verdict/
├── frontend/
│   ├── src/
│   │   ├── components/   # report view, landing page, input box
│   │   ├── pages/
│   │   └── lib/          # API client, polling logic
├── backend/
│   ├── src/
│   │   ├── capture/       # Playwright session: screenshot + Web Vitals + axe-core
│   │   ├── agents/         # visualCritique.ts, copyCritique.ts, scoring.ts
│   │   ├── routes/          # /api/audits
│   │   ├── db/                # schema, migrations, client
│   │   └── lib/                 # rate limiter, storage client, Gemini client
│   └── tests/
├── CLAUDE.md
├── AGENTS.md
├── ARCHITECTURE.md
└── TODO.md
```

---

## Key Files
| File | Purpose |
|------|---------|
| `backend/src/capture/session.ts` | Single Playwright session: screenshot, Web Vitals via CDP, axe-core injection |
| `backend/src/capture/egressProxy.ts` | In-process filtering egress forward proxy: DNS-pinning, BlockList enforcement on CONNECT/HTTP, port restriction |
| `backend/src/agents/visualCritique.ts` | Gemini vision call: hierarchy, clutter, CTA visibility |
| `backend/src/agents/copyCritique.ts` | Gemini call: five-second test, CTA copy, trust signals |
| `backend/src/agents/scoring.ts` | Aggregation + impact-based ranking |
| `backend/src/routes/audits.ts` | Job creation + status polling endpoints |
| `backend/src/lib/clientIp.ts` | Canonical client IP resolver: validates cf-connecting-ip against BlockList, falls back closed to socket, ignores forged XFF |
| `backend/src/lib/rateLimit.ts` | Cookie-based and IP-based free-audit limiter |
| `.env.example` | Required environment variables |

---

## Data Flow
User pastes URL → frontend `POST /api/audits` → backend creates `AuditJob` → Playwright captures desktop+mobile screenshots, Web Vitals, axe-core findings in one session (routed through local SSRF egress proxy) → screenshots uploaded to Supabase Storage → Visual Critique Agent + Copy Critique Agent call Gemini API (gemini-3.1-flash-lite) in parallel → Scoring Agent aggregates into `AuditScore` + ranked `ActionItem`s → saved to Postgres → frontend polls `/api/audits/:id/status` → renders report.

---

## Database Migrations (Drizzle)

All commands run from `backend/`.

```bash
# Generate SQL migration files from schema changes (tracked in git, run in production)
npm run db:generate

# Apply schema directly to the connected DB (dev shortcut — skips migration files)
npm run db:push

# Open Drizzle Studio — visual DB browser (requires live DATABASE_URL)
npm run db:studio
```

> **Important for Koyeb:** `db:push` and `db:studio` require `DATABASE_URL` to be set in `.env`. The `db:generate` step only reads the schema file and requires no DB connection — safe to run before credentials are available.

> **Migration Policy & AI Workflow:** `drizzle.config.ts` maintains `strict: true`. Because `drizzle-kit push` requires an interactive TTY confirmation for *any* schema change in strict mode, it will always fail in the agent's non-interactive shell. To push changes, the agent must use `--force`. **CRITICAL RULE:** The agent must never use `--force` unilaterally. It must always halt, report the schema changes intended, and ask the user for explicit go-ahead before running `npx drizzle-kit push --force`, every time.

---

- **Single Playwright session over Playwright + Lighthouse:** cuts compute per audit roughly in half — essential for free-tier memory & CPU limits.
- **SSRF protection via filtering forward proxy:** in-process forward proxy pins upstream connections directly to validated IPs via `node:net` `BlockList`, closes DNS-rebinding windows, covers WebSockets, blocks loopback/private/cloud-metadata ranges, and restricts ports to 80/443. Chromium is configured with `bypass: '<-loopback>'` so all loopback traffic traverses the proxy. A second-layer `page.route` inspection operates in-browser.
- **Single Node runtime over FastAPI split:** avoids a cross-language boundary with no functional benefit on a solo project.
- **Async job + polling, not a blocking request:** Serverless cold starts and request timeouts make a single long blocking call unreliable.
- **Client IP identity via cf-connecting-ip (trustProxy: false):** Live testing on Render proved reverse proxies append to client-supplied `X-Forwarded-For` rather than overwriting it. With Fastify's `trustProxy: true` selecting the leftmost IP, `request.ip` became attacker-controlled, undermining IP-keyed rate limits and queue concurrency. Verdict sets `trustProxy: false` and resolves canonical client IP strictly from Cloudflare's non-spoofable `cf-connecting-ip` (validating public IP format against `BlockList` and falling back closed to the socket peer address).
- **Fastify global bodyLimit (32KB):** Enforces a 32768-byte payload cap at the Fastify server layer to mitigate memory exhaustion and input parser abuse while safely accommodating valid JSON submissions.
- **Cookie + IP double rate-limiting, no login:** keeps the "paste a URL, done" experience frictionless per the MVP spec while preventing cookie-dropping bypasses.

---

## Environment Variables Required
```bash
GEMINI_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
SUPABASE_STORAGE_BUCKET=
DATABASE_URL=
PORT=
RATE_LIMIT_FREE_AUDITS_PER_DAY=
```

---

## Known Technical Debt
- [ ] **OpenAI vision allowlist requires manual maintenance.** `providers/openai.ts` exports `VISION_MODEL_PREFIXES` — a prefix-based allowlist used because OpenAI's `GET /v1/models` response has no capability flags. This list must be manually updated whenever OpenAI ships new vision-capable models. Last verified: 2026-07-30. This is permanent maintenance debt, not a one-time gap.
- [ ] **Gemini responseJsonSchema requires 2.5+ models.** `providers/gemini.ts` passes the derived JSON Schema to `responseJsonSchema`, assuming Gemini 2.5+ models (true for the current default and any modern BYOK Gemini model). Pre-2.5 models do not support this field and would need a fallback to the OpenAPI subset. Not worth building defensively for now, just ensure the model list catalog stays current so this doesn't quietly resurface.
- [ ] **Anthropic + xAI adapters live-verification pending.** Both adapters are code-complete and reviewed to the same standard as the verified Gemini and OpenAI adapters, but have not been tested against their real `/models` endpoints. Blocked by missing API keys — see TODO.md.
- [ ] Koyeb free tier 512MB RAM ceiling means only one Playwright capture job may run at a time — managed via an in-process queue to prevent OOM crashes.
- [ ] Koyeb free tier 0.1 vCPU limit will result in slower capture execution times compared to local testing.
- [ ] Koyeb free tier regions (Frankfurt/Washington D.C.) add cross-region network latency to the Supabase ap-south-1 database.
- [ ] No competitor comparison mode yet (stretch)
- [ ] No PDF export yet (stretch)
- [ ] No historical tracking / re-run comparison yet (stretch)
