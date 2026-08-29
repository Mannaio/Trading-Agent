# Polymarket RSI Specialist Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Polymarket Up/Down mode (5m chart, 5m/15m market window) with parallel RSI / DRO / EMA+DPO specialist agents and a Decision step that outputs `UP | DOWN | SKIP` + confidence + max buy ¢, without changing existing Scalp behavior.

**Architecture:** New `POST /api/polymarket/analyze` route runs `PolymarketOrchestrator`: three vision specialists in parallel (`gpt-4o`), then a hybrid Decision step — deterministic correlation gate in TypeScript plus an LLM pass (`gpt-4o-mini`) for confidence, reasoning, and EMA+DPO soft veto narrative. Frontend gains a top tab (`Scalp | Polymarket`). Capture server adds a fast 5m-only polymarket capture path with DRO dominance crop.

**Tech Stack:** Cloudflare Workers, Hono, OpenAI SDK (`gpt-4o` vision, `gpt-4o-mini` text), TypeScript, React + Vite + Tailwind, Playwright capture server

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-10-polymarket-rsi-agent-design.md`
- RSI settings on chart: length **2**, source **close**, smoothing **SMA 14**, divergence **off**
- DRO dominance: lookback **1h 10m (70 min)**, color = **latest stretch at now**, fresh flip **accepted**, RSI extreme still required
- Correlation gate (hard): green + RSI peak → DOWN; red + RSI trough → UP; else SKIP
- Safety buffer for max buy: **12¢** below fair value (= confidence)
- Scalp tab and `POST /api/analyze` must remain unchanged in behavior
- Imports at top of file; exhaustive switch with `never` on union defaults
- SYNC comment: polymarket types mirrored in `worker/src/polymarket/types.ts` and `frontend/src/types-polymarket.ts`
- No auto-betting, no Chainlink feed, no 15m chart capture in v1

---

## File map (created / modified)

| File | Action | Responsibility |
|------|--------|----------------|
| `worker/src/polymarket/types.ts` | Create | All Polymarket request/response + report types |
| `worker/src/polymarket/validate-polymarket.ts` | Create | Request validation |
| `worker/src/polymarket/decision-gate.ts` | Create | Deterministic correlation + pricing math |
| `worker/src/polymarket/decision-gate.test.ts` | Create | Unit tests for gate logic |
| `worker/src/agents/specialists/rsi.ts` | Create | RSI specialist (vision) |
| `worker/src/agents/specialists/dro.ts` | Create | DRO specialist (vision) |
| `worker/src/agents/specialists/ema-dpo.ts` | Create | EMA+DPO specialist (vision) |
| `worker/src/agents/specialists/decision.ts` | Create | Decision LLM + gate integration |
| `worker/src/agents/polymarket-orchestrator.ts` | Create | Parallel specialists → decision |
| `worker/src/index.ts` | Modify | Add `/api/polymarket/analyze` |
| `worker/package.json` | Modify | Add vitest for gate tests |
| `capture/src/capture-polymarket.ts` | Create | 5m single-shot capture + dominance crop |
| `capture/src/server.ts` | Modify | `GET /capture/polymarket` |
| `frontend/src/types-polymarket.ts` | Create | Mirror worker polymarket types |
| `frontend/src/components/scalp/AnalysisForm.tsx` | Move | Existing form (unchanged logic) |
| `frontend/src/components/scalp/AnalysisResult.tsx` | Move | Existing result (unchanged logic) |
| `frontend/src/components/polymarket/PolymarketForm.tsx` | Create | Capture + analyze form |
| `frontend/src/components/polymarket/PolymarketResult.tsx` | Create | UP/DOWN/SKIP display |
| `frontend/src/components/polymarket/PolymarketHistoryList.tsx` | Create | Separate history list |
| `frontend/src/App.tsx` | Modify | Tab switch + polymarket handlers |

---

### Task 1: Polymarket types (worker + frontend)

**Files:**
- Create: `worker/src/polymarket/types.ts`
- Create: `frontend/src/types-polymarket.ts`

**Interfaces:**
- Produces: `PolymarketCall`, `PolymarketMarketWindow`, `RsiReport`, `DroReport`, `EmaDpoReport`, `PolymarketScreenshotMeta`, `PolymarketRequest`, `PolymarketResponse`

- [ ] **Step 1: Create `worker/src/polymarket/types.ts`**

```typescript
export type PolymarketCall = 'UP' | 'DOWN' | 'SKIP';
export type PolymarketMarketWindow = '5m' | '15m';

export interface RsiReport {
  rsiValue: number | null;
  zone: 'oversold' | 'mid' | 'overbought';
  slope: 'rising' | 'falling' | 'flat';
  extreme: 'peak' | 'trough' | 'none';
  roomToMove: 'spike' | 'drop' | 'both' | 'none';
  roomConfidence: number;
  marginNotes: string;
  bias: 'bullish' | 'bearish' | 'neutral';
  caveats: string[];
}

export interface DroReport {
  dominanceColor: 'green' | 'red' | 'unclear';
  dominanceSinceBars: number | null;
  lookbackWindow: 'last_70_minutes';
  alertCycle: {
    pivotDirection: 'LOW' | 'HIGH' | 'unclear';
    mean: number | null;
    barsSincePivot: number | null;
  };
  notes: string;
}

export interface EmaDpoReport {
  emaBias: 'bullish' | 'bearish' | 'neutral';
  emaGap: 'tight' | 'moderate' | 'wide';
  priceVsEma: 'extended_above' | 'between' | 'extended_below' | 'unclear';
  dpoSwing: {
    lastHighHighDistance: number | null;
    lastLowLowDistance: number | null;
    interpretation: string;
  };
  supportsCall: 'yes' | 'no' | 'neutral';
  notes: string;
}

export interface PolymarketScreenshotMeta {
  rsi?: number;
  rsiCrop?: string;
  droCrop?: string;
  droDominanceCrop?: string;
}

export interface PolymarketMarketPrices {
  upCents: number;
  downCents: number;
}

export interface PolymarketRequest {
  symbol: 'ETHUSDT';
  screenshot: string;
  screenshotsMeta?: PolymarketScreenshotMeta;
  marketWindow: PolymarketMarketWindow;
  marketPrices?: PolymarketMarketPrices;
  notes?: string;
}

export interface PolymarketResponse {
  call: PolymarketCall;
  confidence: number;
  marketWindow: PolymarketMarketWindow;
  maxBuyUpCents: number | null;
  maxBuyDownCents: number | null;
  edgeNote: string;
  reasoning: string;
  reports: {
    rsi: RsiReport;
    dro: DroReport;
    emaDpo: EmaDpoReport;
  };
  vetoApplied: boolean;
  correlationCall: PolymarketCall;
  timestamp: string;
}

/** Input bundle passed from orchestrator to DecisionAgent */
export interface PolymarketAnalysisInput {
  request: PolymarketRequest;
  reports: {
    rsi: RsiReport;
    dro: DroReport;
    emaDpo: EmaDpoReport;
  };
  gateCall: PolymarketCall;
}
```

- [ ] **Step 2: Copy identical exports to `frontend/src/types-polymarket.ts`**

Add frontend-only types at bottom:

```typescript
export type PolymarketOutcome = 'review' | 'took' | 'skipped' | 'won' | 'lost';

export interface StoredPolymarketAnalysis extends PolymarketResponse {
  id: string;
  symbol: 'ETHUSDT';
  notes?: string;
  marketPrices?: PolymarketMarketPrices;
  outcome: PolymarketOutcome;
  outcomeTimestamp?: string;
}

export const POLYMARKET_CALL_CONFIG: Record<
  PolymarketCall,
  { label: string; color: string; emoji: string }
> = {
  UP: { label: 'UP', color: 'text-emerald-400', emoji: '🟢' },
  DOWN: { label: 'DOWN', color: 'text-red-400', emoji: '🔴' },
  SKIP: { label: 'SKIP', color: 'text-yellow-400', emoji: '🟡' },
};
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd worker && npx tsc --noEmit`  
Expected: no errors (may need tsconfig include path for new folder — it already includes `src/**/*`)

Run: `cd frontend && npx tsc --noEmit`  
Expected: no errors

---

### Task 2: Request validation

**Files:**
- Create: `worker/src/polymarket/validate-polymarket.ts`

**Interfaces:**
- Consumes: types from `./types.ts`
- Produces: `validatePolymarketRequest(body: unknown): PolymarketRequest`, `PolymarketValidationError`

- [ ] **Step 1: Implement validator**

```typescript
import type { PolymarketMarketWindow, PolymarketRequest } from './types';

const VALID_WINDOWS: PolymarketMarketWindow[] = ['5m', '15m'];

export class PolymarketValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolymarketValidationError';
  }
}

export function validatePolymarketRequest(body: unknown): PolymarketRequest {
  if (!body || typeof body !== 'object') {
    throw new PolymarketValidationError('Request body must be a JSON object');
  }
  const b = body as Record<string, unknown>;

  if (b.symbol !== 'ETHUSDT') {
    throw new PolymarketValidationError('symbol must be ETHUSDT');
  }

  if (typeof b.screenshot !== 'string' || !b.screenshot.startsWith('data:image/')) {
    throw new PolymarketValidationError('screenshot must be a base64 data URL');
  }

  if (b.marketWindow !== '5m' && b.marketWindow !== '15m') {
    throw new PolymarketValidationError(`marketWindow must be one of: ${VALID_WINDOWS.join(', ')}`);
  }

  let screenshotsMeta: PolymarketRequest['screenshotsMeta'];
  if (b.screenshotsMeta != null) {
    if (typeof b.screenshotsMeta !== 'object') {
      throw new PolymarketValidationError('screenshotsMeta must be an object');
    }
    const m = b.screenshotsMeta as Record<string, unknown>;
    screenshotsMeta = {};
    if (m.rsi != null) {
      if (typeof m.rsi !== 'number' || m.rsi < 0 || m.rsi > 100) {
        throw new PolymarketValidationError('screenshotsMeta.rsi must be 0-100');
      }
      screenshotsMeta.rsi = m.rsi;
    }
    for (const key of ['rsiCrop', 'droCrop', 'droDominanceCrop'] as const) {
      if (m[key] != null) {
        if (typeof m[key] !== 'string' || !(m[key] as string).startsWith('data:image/')) {
          throw new PolymarketValidationError(`screenshotsMeta.${key} must be a data URL`);
        }
        screenshotsMeta[key] = m[key] as string;
      }
    }
  }

  let marketPrices: PolymarketRequest['marketPrices'];
  if (b.marketPrices != null) {
    if (typeof b.marketPrices !== 'object') {
      throw new PolymarketValidationError('marketPrices must be an object');
    }
    const p = b.marketPrices as Record<string, unknown>;
    if (typeof p.upCents !== 'number' || typeof p.downCents !== 'number') {
      throw new PolymarketValidationError('marketPrices.upCents and downCents must be numbers');
    }
    if (p.upCents < 1 || p.upCents > 99 || p.downCents < 1 || p.downCents > 99) {
      throw new PolymarketValidationError('marketPrices must be between 1 and 99 cents');
    }
    marketPrices = { upCents: p.upCents, downCents: p.downCents };
  }

  const notes = typeof b.notes === 'string' ? b.notes : undefined;

  return {
    symbol: 'ETHUSDT',
    screenshot: b.screenshot,
    marketWindow: b.marketWindow,
    ...(screenshotsMeta && { screenshotsMeta }),
    ...(marketPrices && { marketPrices }),
    ...(notes && { notes }),
  };
}
```

- [ ] **Step 2: Manual validation check**

Run worker dev, then:

```bash
curl -s -X POST http://localhost:8787/api/polymarket/analyze \
  -H 'Content-Type: application/json' \
  -d '{"symbol":"BTCUSDT"}' | head -c 200
```

Expected (after Task 8 wires route): 400 with symbol error. For now, wire a temporary import in index or test validator via node after Task 8.

---

### Task 3: Deterministic decision gate + unit tests

**Files:**
- Create: `worker/src/polymarket/decision-gate.ts`
- Create: `worker/src/polymarket/decision-gate.test.ts`
- Modify: `worker/package.json`

**Interfaces:**
- Produces:
  - `applyCorrelationGate(rsi: RsiReport, dro: DroReport): PolymarketCall`
  - `computeMaxBuyCents(confidence: number, bufferCents?: number): { maxBuyUpCents: number | null; maxBuyDownCents: number | null }`
  - `applyMarketPriceEdge(call: PolymarketCall, maxBuyUp: number | null, maxBuyDown: number | null, prices?: PolymarketMarketPrices): { call: PolymarketCall; edgeNote: string }`

- [ ] **Step 1: Add vitest to worker**

In `worker/package.json` add:

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
},
"devDependencies": {
  "vitest": "^3.0.0"
}
```

Run: `cd worker && npm install`

- [ ] **Step 2: Implement `decision-gate.ts`**

```typescript
import type {
  DroReport,
  PolymarketCall,
  PolymarketMarketPrices,
  RsiReport,
} from './types';

const DEFAULT_BUFFER_CENTS = 12;

export function applyCorrelationGate(rsi: RsiReport, dro: DroReport): PolymarketCall {
  if (dro.dominanceColor === 'unclear') return 'SKIP';
  if (dro.dominanceColor === 'green' && rsi.extreme === 'peak') return 'DOWN';
  if (dro.dominanceColor === 'red' && rsi.extreme === 'trough') return 'UP';
  return 'SKIP';
}

export function computeMaxBuyCents(
  confidence: number,
  bufferCents = DEFAULT_BUFFER_CENTS,
): { maxBuyUpCents: number | null; maxBuyDownCents: number | null } {
  const clamped = Math.max(0, Math.min(100, Math.round(confidence)));
  const max = Math.max(1, clamped - bufferCents);
  return { maxBuyUpCents: max, maxBuyDownCents: max };
}

export function applyMarketPriceEdge(
  call: PolymarketCall,
  maxBuyUpCents: number | null,
  maxBuyDownCents: number | null,
  prices?: PolymarketMarketPrices,
): { call: PolymarketCall; edgeNote: string } {
  if (call === 'SKIP' || !prices) {
    return { call, edgeNote: call === 'SKIP' ? 'No trade setup.' : 'No market prices provided for edge check.' };
  }
  if (call === 'UP') {
    if (maxBuyUpCents != null && prices.upCents > maxBuyUpCents) {
      return {
        call: 'SKIP',
        edgeNote: `Market Up ${prices.upCents}¢ exceeds max ${maxBuyUpCents}¢ — skip.`,
      };
    }
    return {
      call: 'UP',
      edgeNote: `Buy Up only ≤ ${maxBuyUpCents}¢ (market Up ${prices.upCents}¢).`,
    };
  }
  if (call === 'DOWN') {
    if (maxBuyDownCents != null && prices.downCents > maxBuyDownCents) {
      return {
        call: 'SKIP',
        edgeNote: `Market Down ${prices.downCents}¢ exceeds max ${maxBuyDownCents}¢ — skip.`,
      };
    }
    return {
      call: 'DOWN',
      edgeNote: `Buy Down only ≤ ${maxBuyDownCents}¢ (market Down ${prices.downCents}¢).`,
    };
  }
  return { call: 'SKIP', edgeNote: 'No trade setup.' };
}
```

- [ ] **Step 3: Write tests**

```typescript
import { describe, expect, it } from 'vitest';
import { applyCorrelationGate, applyMarketPriceEdge, computeMaxBuyCents } from './decision-gate';
import type { DroReport, RsiReport } from './types';

const baseRsi = (over: Partial<RsiReport>): RsiReport => ({
  rsiValue: 72,
  zone: 'overbought',
  slope: 'falling',
  extreme: 'peak',
  roomToMove: 'drop',
  roomConfidence: 80,
  marginNotes: '',
  bias: 'bearish',
  caveats: [],
  ...over,
});

const baseDro = (over: Partial<DroReport>): DroReport => ({
  dominanceColor: 'green',
  dominanceSinceBars: 3,
  lookbackWindow: 'last_70_minutes',
  alertCycle: { pivotDirection: 'HIGH', mean: 57, barsSincePivot: 12 },
  notes: '',
  ...over,
});

describe('applyCorrelationGate', () => {
  it('green + peak → DOWN', () => {
    expect(applyCorrelationGate(baseRsi({ extreme: 'peak' }), baseDro({ dominanceColor: 'green' }))).toBe('DOWN');
  });
  it('red + trough → UP', () => {
    expect(
      applyCorrelationGate(
        baseRsi({ extreme: 'trough', zone: 'oversold', rsiValue: 25 }),
        baseDro({ dominanceColor: 'red' }),
      ),
    ).toBe('UP');
  });
  it('green + trough → SKIP', () => {
    expect(
      applyCorrelationGate(baseRsi({ extreme: 'trough' }), baseDro({ dominanceColor: 'green' })),
    ).toBe('SKIP');
  });
  it('unclear dominance → SKIP', () => {
    expect(applyCorrelationGate(baseRsi({}), baseDro({ dominanceColor: 'unclear' }))).toBe('SKIP');
  });
});

describe('computeMaxBuyCents', () => {
  it('70 confidence → 58 max with 12 buffer', () => {
    expect(computeMaxBuyCents(70).maxBuyUpCents).toBe(58);
  });
});

describe('applyMarketPriceEdge', () => {
  it('skips when market price too high', () => {
    const r = applyMarketPriceEdge('UP', 55, 55, { upCents: 60, downCents: 41 });
    expect(r.call).toBe('SKIP');
  });
});
```

- [ ] **Step 4: Run tests**

Run: `cd worker && npm test`  
Expected: all tests PASS

---

### Task 4: RSI specialist agent

**Files:**
- Create: `worker/src/agents/specialists/rsi.ts`

**Interfaces:**
- Consumes: `PolymarketRequest`
- Produces: `RsiAgent.analyze(req: PolymarketRequest): Promise<RsiReport>`

- [ ] **Step 1: Create agent class**

Follow pattern from `worker/src/agents/extraction.ts`:
- Model: `gpt-4o`, temperature `0`, `response_format: { type: 'json_object' }`
- Messages: system prompt + user content with main screenshot, optional `rsiCrop`, authoritative DOM RSI if present
- System prompt must include:
  - RSI length 2, SMA 14 smoothing
  - Zone thresholds ~30/70 (visual peak/trough for RSI 2)
  - `extreme`: peak = overbought spike visible; trough = oversold dip visible; none = mid
  - **Room to move** definition from spec
  - Do NOT output UP/DOWN/SKIP
- Parse JSON into `RsiReport` with enum validation (use `never` in default switch)

Key system prompt excerpt:

```
You analyze ONLY the RSI pane on a 5-minute ETH chart.
Settings: RSI(2), close, SMA(14) smoothing. Divergence labels are OFF.
extreme: "peak" if RSI shows a clear overbought spike (green fill / near upper band).
         "trough" if clear oversold dip (red fill / near lower band).
         "none" otherwise.
roomToMove: judge travel before next band — spike/drop/both/none.
Do NOT recommend UP, DOWN, or SKIP.
Return JSON matching RsiReport schema exactly.
```

- [ ] **Step 2: Export `RsiAgentError`**

Mirror `ExtractionError` pattern from `extraction.ts`.

---

### Task 5: DRO specialist agent

**Files:**
- Create: `worker/src/agents/specialists/dro.ts`

**Interfaces:**
- Produces: `DroAgent.analyze(req: PolymarketRequest): Promise<DroReport>`

- [ ] **Step 1: Create agent class**

Vision inputs: main screenshot + `droDominanceCrop` (preferred) + `droCrop` (DRO Alert pane)

System prompt must encode dominance rules:
- Lookback: last **70 minutes** (~14 bars on 5m)
- Dominance color = **latest green/red stretch at the live edge** (not majority of hour)
- Fresh flip: report color immediately; note `dominanceSinceBars`
- `lookbackWindow` must always be `"last_70_minutes"`
- Secondary: read DRO Alert zigzag for pivotDirection, mean, barsSincePivot

Return `DroReport` JSON only.

---

### Task 6: EMA + DPO specialist agent

**Files:**
- Create: `worker/src/agents/specialists/ema-dpo.ts`

**Interfaces:**
- Produces: `EmaDpoAgent.analyze(req: PolymarketRequest): Promise<EmaDpoReport>`

- [ ] **Step 1: Create agent class**

Vision input: main screenshot (price pane + DPO zig-zag if visible)

System prompt:
- EMA 50 vs 200 structure, gap, price position
- DPO swing: last High–High and Low–Low distance (describe if numbers not readable)
- `supportsCall`: yes/no/neutral — **does not** decide UP/DOWN; flags alignment only

---

### Task 7: Decision agent (gate + LLM)

**Files:**
- Create: `worker/src/agents/specialists/decision.ts`

**Interfaces:**
- Consumes: `PolymarketAnalysisInput` (reports + precomputed `gateCall`)
- Produces: `DecisionAgent.decide(input: PolymarketAnalysisInput): Promise<Omit<PolymarketResponse, 'timestamp'>>`

- [ ] **Step 1: Implement hybrid decision**

Flow inside `decide()`:

1. `gateCall = applyCorrelationGate(rsi, dro)` (recompute or trust orchestrator)
2. If `gateCall === 'SKIP'` → return early with confidence 40, empty max buys, reasoning "Correlation gate: SKIP"
3. If `emaDpo.supportsCall === 'no'` → set `vetoApplied: true`, downgrade to SKIP OR reduce confidence by 15 (spec: soft veto — **downgrade to SKIP in v1**)
4. Else call `gpt-4o-mini` with text-only reports + gateCall + marketWindow to produce:
   - `confidence` (0-100)
   - `reasoning` (2-4 sentences)
5. `computeMaxBuyCents(confidence)`
6. `applyMarketPriceEdge(finalCall, maxUp, maxDown, request.marketPrices)`
7. Return full response including `correlationCall: gateCall` and nested `reports`

System prompt for LLM:

```
You are the Decision Agent for Polymarket ETH Up/Down.
The correlation gate has already determined: {gateCall}.
Rules you must NOT override:
- green dominance + RSI peak → DOWN only
- red dominance + RSI trough → UP only
- mismatches → SKIP
Your job: assign confidence 0-100 based on report quality and EMA+DPO support.
If EMA+DPO supportsCall is "no" and gate was UP or DOWN, output SKIP with vetoApplied.
Do not invent indicator values not in the reports.
```

- [ ] **Step 2: Parse and clamp confidence 0-100**

---

### Task 8: Polymarket orchestrator + API route

**Files:**
- Create: `worker/src/agents/polymarket-orchestrator.ts`
- Modify: `worker/src/index.ts`

**Interfaces:**
- Produces: `PolymarketOrchestrator.run(req: PolymarketRequest): Promise<PolymarketResponse>`

- [ ] **Step 1: Create orchestrator**

```typescript
export class PolymarketOrchestrator {
  constructor(apiKey: string) { /* rsi, dro, emaDpo, decision agents */ }

  async run(req: PolymarketRequest): Promise<PolymarketResponse> {
    const [rsi, dro, emaDpo] = await Promise.all([
      this.rsi.analyze(req),
      this.dro.analyze(req),
      this.emaDpo.analyze(req),
    ]);
    const gateCall = applyCorrelationGate(rsi, dro);
    const decision = await this.decision.decide({
      request: req,
      reports: { rsi, dro, emaDpo },
      gateCall,
    });
    return { ...decision, timestamp: new Date().toISOString() };
  }
}
```

- [ ] **Step 2: Add route to `index.ts`**

```typescript
import { validatePolymarketRequest, PolymarketValidationError } from './polymarket/validate-polymarket';
import { PolymarketOrchestrator, PolymarketPipelineError } from './agents/polymarket-orchestrator';

app.post('/api/polymarket/analyze', async (c) => {
  // same apiKey check as /api/analyze
  const request = validatePolymarketRequest(body);
  const orchestrator = new PolymarketOrchestrator(apiKey);
  const result = await orchestrator.run(request);
  return c.json(result);
});
```

Handle `PolymarketValidationError` → 400, `PolymarketPipelineError` → 502.

- [ ] **Step 3: Integration test with real screenshot**

Run: `cd worker && npm run dev`

Use a saved 5m screenshot from `assets/` as base64 in a JSON file, POST to `/api/polymarket/analyze`.

Expected: JSON with `call`, `confidence`, `reports.rsi`, `reports.dro`, `reports.emaDpo`, `timestamp`.

---

### Task 9: Polymarket capture (5m single shot)

**Files:**
- Create: `capture/src/capture-polymarket.ts`
- Modify: `capture/src/server.ts`
- Modify: `capture/src/capture.ts` (export shared helpers if needed)

**Interfaces:**
- Produces: `capturePolymarketCharts(options): Promise<PolymarketCaptureResult>`

```typescript
export interface PolymarketCaptureResult {
  screenshot: string;
  rsi: number | null;
  rsiCrop: string | null;
  droCrop: string | null;
  droDominanceCrop: string | null;
  symbol: string;
  timeframe: '5m';
}
```

- [ ] **Step 1: Implement `capturePolymarketCharts`**

Logic:
1. Connect CDP (reuse from `capture.ts`)
2. Ensure symbol (default ETHUSDT)
3. Switch to **5m only** — selector `[data-value="5"]`
4. Wait for indicators (reuse wait loop, shorter timeout OK)
5. Full page screenshot → `screenshot`
6. Reuse `extractRsiValue`, `captureRsiLegend`, `captureDroPane`
7. Add **`captureDroDominancePane(page)`** — find pane whose legend matches `/Detrended Rhythm Oscillator.*DRO.*Alerts/i`, screenshot full pane (green/red background bands)

- [ ] **Step 2: Add route**

```typescript
import { capturePolymarketCharts } from './capture-polymarket.js';

app.get('/capture/polymarket', async (req, res) => {
  const symbol = (req.query.symbol as string) ?? 'ETHUSDT';
  const result = await capturePolymarketCharts({ symbol });
  res.json(result);
});
```

Keep existing `GET /capture` unchanged for Scalp.

- [ ] **Step 3: Manual capture test**

Run capture server + TradingView on 5m ETH.

Run: `curl -s http://localhost:3001/capture/polymarket?symbol=ETHUSDT | jq 'keys'`

Expected: `["screenshot","rsi","rsiCrop","droCrop","droDominanceCrop","symbol","timeframe"]`

---

### Task 10: Frontend — move Scalp components + tab shell

**Files:**
- Move: `frontend/src/components/AnalysisForm.tsx` → `frontend/src/components/scalp/AnalysisForm.tsx`
- Move: `frontend/src/components/AnalysisResult.tsx` → `frontend/src/components/scalp/AnalysisResult.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Move files and fix imports**

Update `App.tsx`:

```typescript
import { AnalysisForm } from './components/scalp/AnalysisForm';
import { AnalysisResult } from './components/scalp/AnalysisResult';
```

No logic changes inside moved files.

- [ ] **Step 2: Add tab state to App**

```typescript
type AppMode = 'scalp' | 'polymarket';
const [mode, setMode] = useState<AppMode>('scalp');
```

Header tabs:

```tsx
<button onClick={() => setMode('scalp')} className={mode === 'scalp' ? 'active' : ''}>Scalp</button>
<button onClick={() => setMode('polymarket')} className={mode === 'polymarket' ? 'active' : ''}>Polymarket</button>
```

Render scalp grid when `mode === 'scalp'`; polymarket placeholder until Task 11.

- [ ] **Step 3: Verify scalp still works**

Run: `cd frontend && npm run dev`  
Expected: Scalp tab unchanged; capture + analyze still hit `/api/analyze`.

---

### Task 11: Polymarket form + result + history

**Files:**
- Create: `frontend/src/components/polymarket/PolymarketForm.tsx`
- Create: `frontend/src/components/polymarket/PolymarketResult.tsx`
- Create: `frontend/src/components/polymarket/PolymarketHistoryList.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: PolymarketForm**

Fields:
- Market window select: `5m` | `15m`
- Optional market prices: Up ¢, Down ¢ (number inputs 1-99)
- Optional notes textarea
- Capture button → `fetch('/capture/polymarket?symbol=ETHUSDT')`
- Store single screenshot + meta in state
- Submit → `POST /api/polymarket/analyze`

Request body:

```typescript
{
  symbol: 'ETHUSDT',
  screenshot: entry.dataUrl,
  screenshotsMeta: {
    rsi: entry.rsi,
    rsiCrop: entry.rsiCrop,
    droCrop: entry.droCrop,
    droDominanceCrop: entry.droDominanceCrop,
  },
  marketWindow,
  marketPrices: upCents && downCents ? { upCents, downCents } : undefined,
  notes,
}
```

- [ ] **Step 2: PolymarketResult**

Display:
- Large `UP` / `DOWN` / `SKIP` using `POLYMARKET_CALL_CONFIG`
- Confidence %
- `maxBuyUpCents` / `maxBuyDownCents` + `edgeNote`
- Collapsible `<details>` for each specialist report (JSON fields as readable rows)
- Buttons: **Took trade** → outcome `took`, **Skipped** → `skipped`, **Mark won** / **Mark lost**

No price tracker, no entry/SL/TP.

- [ ] **Step 3: History in App.tsx**

```typescript
const POLYMARKET_STORAGE_KEY = 'trading-agent-polymarket-history';
```

Separate state: `polymarketHistory`, `selectedPolymarket`, handlers mirroring scalp but simpler outcomes.

Wire `PolymarketForm` + `PolymarketResult` + `PolymarketHistoryList` when `mode === 'polymarket'`.

- [ ] **Step 4: End-to-end UI test**

1. Start worker, capture, frontend
2. Polymarket tab → Capture → Analyze
3. See call + reports
4. Mark skipped → appears in history

---

### Task 12: Prompt tuning pass (Phase 4 lite)

**Files:**
- Modify: `worker/src/agents/specialists/rsi.ts`
- Modify: `worker/src/agents/specialists/dro.ts`
- Modify: `worker/src/agents/specialists/ema-dpo.ts`
- Modify: `worker/src/agents/specialists/decision.ts`

- [ ] **Step 1: Run 3 real captures from user's TradingView layout**

Save outputs; note misreads (dominance color, RSI extreme).

- [ ] **Step 2: Tighten prompts**

Add few-shot notes from user examples:
- Green dominance + RSI higher pick → expect DOWN correlation (specialists describe, Decision applies)
- Dominance ≠ candle colors

- [ ] **Step 3: Re-run gate tests**

Run: `cd worker && npm test`  
Expected: PASS (gate logic unchanged)

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Parallel RSI / DRO / EMA+DPO specialists | Tasks 4–6, 8 |
| Decision UP/DOWN/SKIP + confidence + max buy ¢ | Tasks 3, 7, 8 |
| Correlation gate (green+peak, red+trough, else SKIP) | Task 3 |
| Dominance 70m, latest stretch, fresh flip | Task 5 prompt |
| RSI 2 + SMA 14 | Task 4 prompt |
| 5m chart only | Tasks 9, 11 |
| marketWindow 5m/15m metadata | Tasks 1, 11 |
| Tab integration Scalp \| Polymarket | Tasks 10–11 |
| Separate history | Task 11 |
| Scalp unchanged | Tasks 10 (move only), 8 (new route) |
| Optional marketPrices edge | Tasks 3, 7, 11 |
| EMA+DPO soft veto | Tasks 6, 7 |

---

## Manual test plan (full flow)

1. `cd worker && npm run dev`
2. `cd capture && npm run dev` (or existing start script)
3. `cd frontend && npm run dev`
4. TradingView: ETH 5m, RSI(2), DRO with Alerts, EMA 50/200, DPO visible
5. Polymarket tab → select 5m market → Capture → enter Up 60¢ Down 41¢ → Analyze
6. Verify: reports populated, call matches gate rules, max buy ¢ shown
7. Switch to Scalp tab → run existing flow → unchanged

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-11-polymarket-rsi-agent.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration  
2. **Inline Execution** — implement tasks in this session with checkpoints

Which approach?
