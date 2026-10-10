# Polymarket Watch Implementation Plan

> **For agentic workers:** Execute inline in this session. Do not commit unless the user asks.

**Goal:** Local 15-minute watcher that captures the 5m chart, posts `/api/polymarket/analyze`, and emails only on UP or DOWN.

**Architecture:** New Node scripts in `capture/`. HTTP to existing capture `:3001` and worker `:8787`. No frontend or worker API changes.

**Tech Stack:** TypeScript, nodemailer, node:test, fetch.

## Global Constraints

- Market prices omitted (v1).
- Email only; no Telegram.
- No email on SKIP or pipeline errors.
- Default symbol ETHUSDT, marketWindow 5m, interval 15 minutes.
- Do not commit `.env` or SMTP secrets.

---

### Task 1: Notify rule + email format

**Files:**
- Create: `capture/src/watch-notify.ts`
- Test: `capture/src/watch-notify.test.ts`
- Modify: `capture/package.json` (test script)

**Produces:**
- `shouldSendEmail(call: PolymarketCall): boolean`
- `formatAlertEmail(input: WatchAlertInput): { subject: string; text: string }`

- [ ] Failing tests for UP/DOWN/SKIP and email copy
- [ ] Implement
- [ ] Tests pass

### Task 2: One tick with injected I/O

**Files:**
- Create: `capture/src/watch-tick.ts`
- Test: `capture/src/watch-tick.test.ts`

**Produces:**
- `runTick(config, deps): Promise<'sent' | 'skip' | 'error'>`

- [ ] Failing tests: UP sends, SKIP silent, capture/analyze errors → `'error'` no email
- [ ] Implement
- [ ] Tests pass

### Task 3: CLI loop + env + docs

**Files:**
- Create: `capture/src/watch-polymarket.ts`
- Create: `capture/env.example`
- Modify: `capture/package.json`
- Modify: `README.md`
- Modify: `.gitignore` (`!.env.example` not needed if using `env.example`)

- [ ] Load env, fail fast on missing SMTP
- [ ] `--once` and 15-minute loop with overlap skip
- [ ] nodemailer send
- [ ] README how to run
