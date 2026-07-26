# CLAUDE.md — Verdict

## Project Overview
**What this project does:** Paste a URL, get a full first-impression website audit (visual hierarchy, mobile responsiveness, accessibility, speed, copy/CTA clarity) in under a minute.
**Stack:** React + Vite + Tailwind (frontend) / Node.js + Fastify + TypeScript (backend) / Playwright + axe-core / Postgres via Supabase / Supabase Storage / Google AI Studio (Gemini API - gemini-2.5-flash)
**Current phase:** MVP build
**Primary goal this sprint:** Working capture pipeline — screenshot + Web Vitals + accessibility scan for a single URL, end to end.

---

## Read These First (Every Session)
- `ARCHITECTURE.md` — codebase map, key decisions, folder structure
- `AGENTS.md` — what was done in previous sessions
- `TODO.md` — what needs to be done next

Global rules from `~/.gemini/config/skills/` (or wherever `agy inspect` confirms) apply unless overridden below.

---

## Project-Specific Rules

### Stack Constraints
- Single Node/TypeScript runtime only. No Python backend, no separate Lighthouse service.
- One Playwright browser session per audit — screenshot, Web Vitals, and axe-core all run in that same page load. Never spin up a second browser instance for one audit.
- All API routes validate input (zod) and wrap logic in try/catch.
- Gemini API calls request strict JSON against a defined schema; validate server-side before using the result.
- No login. Rate-limit by cookie instead.

### Forbidden
- Never hardcode API keys or secrets — env vars only, never committed.
- Never enable Turbo/auto-approve mode for destructive, deploy, or billing-related commands.
- Never let a tool call that spends money or deletes data run without explicit confirmation in the app layer.
- Never swap a chosen library (e.g. adding Lighthouse back in, adding a second browser automation lib) without asking first.
- Never let a blocked or partial capture render as if it were a complete report — always show an explicit failure/partial state.
- Never call Supabase Storage upload without first checking the file size in application code. Reject anything ≥ 5MB before the upload call. Supabase free tier fixes the per-file upload limit at 50MB (not configurable in the UI) — this is separate from the 1GB total bucket storage quota for the whole project.

### Preferred Patterns
- Async job pattern: submit → poll status → render report. Never a single blocking request for a whole audit.
- Rate-limit check happens before any Gemini API call, not after.
- Handle 429 rate-limit responses gracefully from the free tier (there is no spend to cap).
- Every model-generated finding carries a confidence level and stated reasoning, not just a verdict.
- Rank findings by estimated impact, not raw count.

---

## Workflow for This Project

### Starting a Session
1. Read AGENTS.md — understand what was done
2. Read TODO.md — pick the next task
3. Read ARCHITECTURE.md — orient yourself in the codebase
4. State your plan before writing any code
5. Confirm scope: touch only files needed for this task

### Ending a Session
1. Run all tests — fix failures before stopping
2. Run linter/type checker
3. Update AGENTS.md — what you did, what changed
4. Update TODO.md — cross off done, add new items discovered

---

## Grill-Me Protocol
Before starting any new feature, ask:
- What is the exact expected input and output?
- What are the edge cases (blocked site, timeout, malformed model output)?
- What files will be touched?
- What could break?
- Is there existing code that can be reused?

---

## Testing Requirements
- Unit tests for scoring/ranking logic
- Integration test for the full audit pipeline against 2–3 known URLs
- Run: `npm test`
