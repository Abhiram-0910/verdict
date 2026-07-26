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
| AI | Google AI Studio Gemini API (gemini-2.5-flash) | Free tier vision & text model for public-facing audit tool |
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
| `backend/src/agents/visualCritique.ts` | Gemini vision call: hierarchy, clutter, CTA visibility |
| `backend/src/agents/copyCritique.ts` | Gemini call: five-second test, CTA copy, trust signals |
| `backend/src/agents/scoring.ts` | Aggregation + impact-based ranking |
| `backend/src/routes/audits.ts` | Job creation + status polling endpoints |
| `backend/src/lib/rateLimit.ts` | Cookie-based free-audit limiter |
| `.env.example` | Required environment variables |

---

## Data Flow
User pastes URL → frontend `POST /api/audits` → backend creates `AuditJob` → Playwright captures desktop+mobile screenshots, Web Vitals, axe-core findings in one session → screenshots uploaded to Supabase Storage → Visual Critique Agent + Copy Critique Agent call Gemini API (gemini-2.5-flash) in parallel → Scoring Agent aggregates into `AuditScore` + ranked `ActionItem`s → saved to Postgres → frontend polls `/api/audits/:id/status` → renders report.

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
- **Single Node runtime over FastAPI split:** avoids a cross-language boundary with no functional benefit on a solo project.
- **Async job + polling, not a blocking request:** Serverless cold starts and request timeouts make a single long blocking call unreliable.
- **Cookie rate-limiting, no login:** keeps the "paste a URL, done" experience frictionless per the MVP spec.

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
- [ ] Koyeb free tier 512MB RAM ceiling means only one Playwright capture job may run at a time — managed via an in-process queue to prevent OOM crashes.
- [ ] Koyeb free tier 0.1 vCPU limit will result in slower capture execution times compared to local testing.
- [ ] Koyeb free tier regions (Frankfurt/Washington D.C.) add cross-region network latency to the Supabase ap-south-1 database.
- [ ] No competitor comparison mode yet (stretch)
- [ ] No PDF export yet (stretch)
- [ ] No historical tracking / re-run comparison yet (stretch)
