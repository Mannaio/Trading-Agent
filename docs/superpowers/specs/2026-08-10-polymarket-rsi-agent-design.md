# Polymarket RSI Specialist Pipeline — Design Document

**Date:** 2026-08-10  
**Status:** Draft — pending user review  
**Goal:** Add a Polymarket Up/Down mode (5m / 15m ETH events) using parallel indicator specialists and a Decision Agent, reusing existing worker/capture/frontend infrastructure.

---

## 1. Problem & context

The existing app targets **scalp trades** (±0.5% on 4H / 1H / 15m) via a 4-agent pipeline (`Extraction → Timeframe ×3 → Synthesis → Strategy`).

Polymarket ETH Up/Down markets resolve on **Chainlink TWAP** over a fixed window (5m or 15m). There is **no stop-loss** — the stake is the full risk. The user's manual edge is a **correlation between RSI extremes and DRO dominance color**, with EMA + DPO as a final support check.

This is a **different decision model** but can reuse the same backend host, capture server, OpenAI wiring, and frontend shell.

---

## 2. User workflow (manual → automated)

### Primary signal (RSI ↔ DRO dominance)

1. Read **DRO dominance color** (green/red background in "Detrended Rhythm Oscillator (DRO) with Alerts" pane).
2. Wait for **RSI extreme** (overbought peak or oversold trough on RSI 2).
3. Apply correlation:

| DRO dominance (latest stretch) | RSI state | Bias |
|-------------------------------|-----------|------|
| **Green** | High peak / overbought | **DOWN** (fade the spike) |
| **Red** | Low trough / oversold | **UP** (fade the dip) |
| Anything else | — | **SKIP** |

Examples from user charts: green dominance + RSI higher pick → subsequent drop; red dominance + RSI oversold trough → bounce.

### What dominance is NOT

- Dominance color **does not** mean all 5m candles are green/red.
- It is the **cycle/regime tint** in the DRO pane, not candle painting.

### Secondary checks

- **EMA + DPO** (Detrended Rhythm Oscillator price tool / zig-zag swing distances): final soft support or veto after the correlation gate passes.
- **DRO Alert** pane (zigzag + Mean): secondary context for cycle length, not the primary dominance read.

### Decision timeframe

- **5m chart only** for the Polymarket call (single screenshot with all panes visible).
- `marketWindow` metadata (`5m` | `15m`) tells Decision which Polymarket event is being traded; it does not require a separate 15m chart capture.

---

## 3. Indicator configuration (must match TradingView)

### RSI Agent inputs

| Setting | Value |
|---------|--------|
| RSI Length | **2** |
| Source | close |
| Calculate Divergence | **Off** (v1) |
| Smoothing | SMA **14** |
| BB StdDev | 2 (if visible; secondary) |
| Timeframe | Chart (5m) |

### DRO Agent inputs

- Indicator: **Detrended Rhythm Oscillator (DRO) with Alerts**
- Reads: green/red **dominance background**, pivot direction, mean, bars since pivot (secondary)
- Parameters as shown on chart legend (e.g. `21 5 14 9`) — agent reads from screenshot, does not hardcode

### EMA + DPO Agent inputs

- EMA 50 / EMA 200 on price pane
- DPO zig-zag tool: distance between last High–High and Low–Low swings (detrended dominant cycle on price)

---

## 4. DRO dominance — formal definition (v1)

| Rule | Definition |
|------|------------|
| **Lookback window** | Rolling **1h 10m (70 minutes)** ending at capture time (~14 bars on 5m) |
| **Dominance color** | Color of the **latest stretch** touching the live edge of the DRO dominance pane (not majority vote across the hour) |
| **Fresh flip** | Accept immediately — Decision still requires RSI extreme before UP/DOWN |
| **Unclear** | If dominance pane unreadable → DRO report `dominanceColor: unclear` → Decision **SKIP** |

---

## 5. Agent architecture

### Parallel specialists + Decision (recommended)

```
5m screenshot (+ crops)
        ↓
  RSI Agent  ∥  DRO Agent  ∥  EMA+DPO Agent
        ↓
  Decision Agent
        ↓
  UP | DOWN | SKIP + confidence + max buy ¢
```

Specialists **do not** emit UP/DOWN. They emit structured reports only.

Decision Agent applies rules **in order**:

1. DRO dominance (definition above)
2. RSI extreme + room to move
3. **Correlation gate** (hard) — mismatches → **SKIP**
4. EMA+DPO support/veto (soft)
5. Confidence + **max buy ¢** with safety buffer (no SL protection)

### Specialist report schemas

#### RSI Report

```typescript
interface RsiReport {
  rsiValue: number | null;
  zone: 'oversold' | 'mid' | 'overbought';
  slope: 'rising' | 'falling' | 'flat';
  extreme: 'peak' | 'trough' | 'none';
  roomToMove: 'spike' | 'drop' | 'both' | 'none';
  roomConfidence: number; // 0-100
  marginNotes: string;
  bias: 'bullish' | 'bearish' | 'neutral';
  caveats: string[];
}
```

**Room to move** (user manual edge): judge whether RSI lines have travel before hitting the next band — e.g. mid/low RSI rising with clear path to 70 = room to spike; mid/high rolling with path to 30 = room to drop; pinned at 70/30 = little room.

#### DRO Report

```typescript
interface DroReport {
  dominanceColor: 'green' | 'red' | 'unclear';
  dominanceSinceBars: number | null; // bars since current stretch started
  lookbackWindow: 'last_70_minutes';
  alertCycle: {
    pivotDirection: 'LOW' | 'HIGH' | 'unclear';
    mean: number | null;
    barsSincePivot: number | null;
  };
  notes: string;
}
```

#### EMA + DPO Report

```typescript
interface EmaDpoReport {
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
```

#### Decision output

```typescript
type PolymarketCall = 'UP' | 'DOWN' | 'SKIP';

interface PolymarketDecision {
  call: PolymarketCall;
  confidence: number; // 0-100
  marketWindow: '5m' | '15m';
  maxBuyUpCents: number | null;
  maxBuyDownCents: number | null;
  edgeNote: string;
  reasoning: string;
  reports: {
    rsi: RsiReport;
    dro: DroReport;
    emaDpo: EmaDpoReport;
  };
  vetoApplied: boolean; // true if EMA+DPO blocked an otherwise clean correlation
}
```

### Pricing protection (no stop-loss)

Polymarket contracts pay **$1** if correct. Price in ¢ ≈ implied probability.

1. Map `confidence` → fair ¢ for the chosen side.
2. Apply **safety buffer** (default **12¢** below fair value) → `maxBuy*Cents`.
3. If user-provided market price exceeds max → treat as **SKIP** (or warn in UI).
4. v1: **signal + price guidance only** — no auto-bet.

Example: confidence 70% on UP → fair ~70¢ → max buy Up ≤58¢ (with 12¢ buffer). Market at 60¢ → skip.

---

## 6. Application integration

### Mode switch: top tabs (chosen)

Same app, two modes:

| Tab | Pipeline | Endpoint |
|-----|----------|----------|
| **Scalp** | Existing 4-agent pipeline | `POST /api/analyze` |
| **Polymarket** | New specialist pipeline | `POST /api/polymarket/analyze` |

Existing scalp behavior remains unchanged.

### Reuse map

| Component | Scalp | Polymarket |
|-----------|-------|------------|
| Worker (Hono, CORS, health) | ✓ | ✓ |
| OpenAI client pattern | ✓ | ✓ |
| Capture server (CDP) | 4h/1h/15m loop | **5m single shot** |
| Frontend shell (layout, loading, errors) | ✓ | ✓ |
| localStorage history pattern | ✓ | separate key |
| validate.ts pattern | ✓ | new validator |
| ChartExtractionAgent | ✓ | **not used** (specialists read crops) |
| TimeframeAnalysisAgent | ✓ | **not used** |
| SynthesisAgent / StrategyAgent | ✓ | **not used** |
| usePriceTracker | ✓ | **not used** (binary outcome) |

### Backend layout

```
worker/src/
  index.ts                          # add POST /api/polymarket/analyze
  validate-polymarket.ts            # NEW
  types-polymarket.ts               # NEW (or extend types.ts with clear sections)
  agents/
    orchestrator.ts                 # unchanged (scalp)
    polymarket-orchestrator.ts      # NEW
    specialists/
      rsi.ts                        # NEW
      dro.ts                        # NEW
      ema-dpo.ts                    # NEW
      decision.ts                   # NEW
```

### Capture changes

Add `captureMode: 'scalp' | 'polymarket'` (or separate export):

- **Polymarket:** single **5m** screenshot with all panes visible
- Keep **RSI legend crop** + DOM RSI value (authoritative)
- Keep **DRO Alert crop** (cycle context)
- Add **DRO dominance pane crop** (bottom green/red band) for reliable color read
- Return `marketWindow` from frontend request metadata (not from capture)

### Frontend layout

```
frontend/src/
  App.tsx                           # tab state: 'scalp' | 'polymarket'
  components/
    scalp/                          # move existing AnalysisForm, AnalysisResult
    polymarket/
      PolymarketForm.tsx            # 5m capture, market window selector
      PolymarketResult.tsx          # UP/DOWN/SKIP, max buy ¢, specialist reports
      PolymarketHistoryList.tsx     # optional; or shared HistoryList with mode filter
```

**PolymarketForm (v1)**

- Symbol: ETHUSDT (default)
- Auto-capture 5m (reuse capture button pattern)
- Market window: **5m event** | **15m event**
- Optional notes (not required)
- No portfolio / risk fields

**PolymarketResult (v1)**

- Primary: **UP / DOWN / SKIP** + confidence
- **Max buy Up ¢ / Max buy Down ¢** + edge note
- Expandable RSI / DRO / EMA+DPO reports
- Actions: **Took trade** / **Skipped** / **Mark won/lost**
- Separate history key: `trading-agent-polymarket-history`

### API request / response (sketch)

```typescript
interface PolymarketRequest {
  symbol: 'ETHUSDT';
  screenshot: string; // base64 data URL, single 5m chart
  screenshotsMeta?: {
    rsi?: number;
    rsiCrop?: string;
    droCrop?: string;
    droDominanceCrop?: string;
  };
  marketWindow: '5m' | '15m';
  marketPrices?: { upCents: number; downCents: number }; // optional, for edge check
  notes?: string;
}

interface PolymarketResponse extends PolymarketDecision {
  timestamp: string;
}
```

---

## 7. Data flow (end-to-end)

```
User opens Polymarket tab
    → selects market window (5m / 15m)
    → clicks Capture (5m chart from TradingView)
    → optional: enters current Up/Down market prices
    → POST /api/polymarket/analyze
    → PolymarketOrchestrator:
         Promise.all([ RsiAgent, DroAgent, EmaDpoAgent ])
         DecisionAgent.run(reports, marketWindow, marketPrices?)
    → PolymarketResult displays call + max buy ¢ + reports
    → user manually buys on Polymarket if edge exists
    → marks outcome in history
```

---

## 8. Rollout phases

| Phase | Scope |
|-------|--------|
| **1** | Backend: types, validate, 4 agents, orchestrator, `/api/polymarket/analyze` — test with curl + sample screenshots |
| **2** | Capture: polymarket 5m mode + DRO dominance crop |
| **3** | Frontend: tab switch, PolymarketForm, PolymarketResult, history |
| **4** | Tune specialist prompts + optional skills from manual trading rules |

---

## 9. Out of scope (v1)

- Auto-betting on Polymarket
- RSI divergence labels (Calculate Divergence off)
- 15m chart capture as parent timeframe
- Chainlink TWAP live feed integration
- Odds-aware edge vs market (optional `marketPrices` is v1-lite only)
- Shared win-rate stats across modes

---

## 10. Future extensions

- Per-specialist **skills** (checklists from manual experience)
- Tighter dominance rules if vision is unreliable (DOM pixel sampling of DRO pane)
- Backtest log: correlate Decision calls with Polymarket resolutions
- Enable RSI divergence when user turns it on in TradingView

---

## 11. Open parameters (defaults for v1)

| Parameter | Default | Notes |
|-----------|---------|-------|
| Safety buffer (max buy) | 12¢ below fair | Tunable after live use |
| RSI overbought | > 70 (visual peak) | RSI 2 hits extremes often — agent reads chart |
| RSI oversold | < 30 (visual trough) | Same |
| Dominance lookback | 1h 10m (70 minutes) | User confirmed |
| Dominance selection | Latest stretch at now | User confirmed (option B) |
| Fresh flip handling | Accept + wait for RSI extreme | User confirmed (option C) |
| Mismatch pairs | SKIP | User confirmed |

---

## 12. Success criteria

- Polymarket tab produces **UP / DOWN / SKIP** with specialist reports in <30s
- Decision respects correlation gate (no UP on green+peak, etc.)
- Max buy ¢ never exceeds fair value minus buffer
- Scalp tab behavior unchanged
- Capture reliably returns 5m screenshot + RSI value + crops
