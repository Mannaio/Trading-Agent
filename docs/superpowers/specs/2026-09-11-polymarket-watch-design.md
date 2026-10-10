# Spec: Polymarket 15-minute watch + email

**Date:** 2026-09-11  
**Status:** Approved  
**Goal:** Replay the existing Polymarket Analyze flow every 15 minutes and email only when the call is UP or DOWN.

## Objective

The user already runs Capture → Analyze Polymarket by hand. This adds a local watcher that does the same HTTP calls the form uses, then emails on a directional call. SKIP and failures stay in the terminal.

Success: a real UP/DOWN email with call, confidence, max buy ¢, and reasoning. SKIP = no email.

## Tech Stack

- Node 20+ / TypeScript in `capture/`
- Existing capture server (`GET /capture/polymarket`)
- Existing worker (`POST /api/polymarket/analyze`)
- `nodemailer` + Gmail SMTP (app password)
- `node:test` for unit tests (no new test runner)

## Commands

```
cd capture && npm test
cd capture && npx tsc --noEmit
cd capture && npm run watch:polymarket
cd capture && npm run watch:polymarket -- --once
```

## Project Structure

```
capture/src/watch-notify.ts       # shouldSendEmail + formatAlertEmail
capture/src/watch-notify.test.ts
capture/src/watch-tick.ts         # one capture → analyze → maybe email
capture/src/watch-tick.test.ts
capture/src/watch-polymarket.ts   # CLI loop, env, --once
capture/env.example
```

Frontend and worker stay unchanged.

## Code Style

Pure functions for notify/tick with injected deps. No inline imports. Exhaustive switches on `UP | DOWN | SKIP`.

## Testing Strategy

- Unit: `shouldSendEmail` true only for UP/DOWN
- Unit: email subject/body include call, confidence, max buy
- Unit: `runTick` sends mail on UP, not on SKIP, not when capture/analyze throws
- Manual: `--once` against local capture + worker

## Boundaries

- Always: leave Up ¢ / Down ¢ empty; email only on UP/DOWN; log SKIP/errors
- Ask first: Telegram, live Polymarket odds, auto-bet
- Never: click the React form; put cron on Cloudflare; commit SMTP secrets

## Success Criteria

- `npm run watch:polymarket` loops every 15 minutes
- `--once` runs a single tick
- Missing SMTP env fails at startup
- Overlapping ticks are skipped
- Capture/worker/SMTP errors do not crash the loop (except missing config at boot)

## Open Questions

None — Gmail SMTP, ETHUSDT, 5m window, empty market prices.
