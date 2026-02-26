# EMA Distance Analysis — Design Document

**Date:** 2026-02-21

**Goal:** Add EMA 50/200 structure and distance analysis as a dedicated step in the GPT-4o system prompt, so the AI evaluates crossover state and price extension to detect reversal vs. continuation conditions.

## Context

The analysis agent receives up to 3 chart screenshots (4H, 1H, 15m). All charts display EMA 50 (fast) and EMA 200 (slow). The system prompt currently mentions EMAs only in passing — no structured analysis step exists.

## What Changes

**One file modified:** `worker/src/agents/analysis.ts` — the `systemPrompt()` method only. No frontend changes, no new form fields, no type changes. The AI reads EMA 50/200 from the screenshots it already receives.

## Analysis Step (new step 2)

The analysis order becomes:

1. DRO Cycle (primary trend direction) — unchanged
2. **EMA Structure (new)** — macro trend state + exhaustion signal
3. RSI Validation — was step 2
4. DRO Momentum — was step 3
5. Combine — updated to reference EMA/DRO interaction
6. User thesis — unchanged
7. Past lessons — unchanged
8. Trade levels — unchanged

## EMA Structure Step Definition

For each timeframe (4H, 1H, 15m), the AI must:

1. **Identify crossover state:** EMA 50 above EMA 200 = bullish structure (golden cross). EMA 50 below EMA 200 = bearish structure (death cross).
2. **Assess distance between EMA 50 and EMA 200:** Tight (recently crossed or converging), moderate, or wide (strongly trending).
3. **Locate price relative to both EMAs:** Above both, between them, or below both.
4. **Interpret:**
   - Wide EMA spread + price far from both EMAs = overextended, higher reversal probability
   - Narrow EMA spread or recent cross = early trend, likely continuation
   - Price between the two EMAs = indecision / potential trend change
   - EMA 50 curving toward EMA 200 = trend weakening even if spread is still wide

## Reasoning Output

A new "EMA Structure" section is required in the `reasoning` JSON field, placed between "DRO Cycle" and "RSI Validation". The AI must state per-timeframe:

- Crossover state (EMA 50 above/below 200)
- Gap width (tight/moderate/wide)
- Price position relative to EMAs
- Assessment: continuation or exhaustion

Example: *"EMA Structure: 4H — EMA 50 above 200 (bullish), wide gap, price extended well above both → overextended, reversal risk. 1H — EMA 50 above 200 (bullish), moderate gap, price near EMA 50 → healthy trend. 15m — EMA 50 crossing below 200 (bearish cross) → short-term bearish shift."*

## Interaction with Existing Signals

The Combine step is updated to reference EMA structure:

- EMA exhaustion (wide spread, price far) + DRO cycle nearing pivot → strong reversal signal, increase confidence
- EMA early trend (tight spread, recent cross) + DRO mid-cycle → continuation likely
- EMA and DRO disagree → note conflict, reduce confidence

## What Does NOT Change

- No frontend form changes
- No new types or API fields
- No DRO Cycle logic changes
- No RSI logic changes (just renumbered)
- Screenshot upload flow unchanged
