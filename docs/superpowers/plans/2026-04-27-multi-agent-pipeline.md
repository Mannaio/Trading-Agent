# Multi-Agent Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single monolithic `AnalysisAgent` with a 4-agent sequential pipeline (Extraction → Analysis × 3 in parallel → Synthesis → Strategy) that is faster, more accurate, and learns quantitatively from trade history.

**Architecture:** A new `Orchestrator` class in the worker chains four specialized agents. Agent 2 (TimeframeAnalysis) runs three instances in parallel via `Promise.all`. Agents 3 and 4 use `gpt-4o-mini` (text-only). The existing `/api/analyze` endpoint and `AnalysisResponse` shape are preserved for frontend backward compatibility, extended with new optional fields.

**Tech Stack:** Cloudflare Workers, Hono, OpenAI SDK (`gpt-4o` for vision, `gpt-4o-mini` for text), TypeScript, React (frontend)

---

### Task 1: Define All New Types

**Files:**
- Modify: `worker/src/types.ts`
- Modify: `frontend/src/types.ts`

- [ ] **Step 1: Add intermediate pipeline types to `worker/src/types.ts`**

```typescript
// ─── Agent 1 output: raw extracted data per chart ───
export interface ChartExtraction {
  timeframe: Timeframe;
  ema50: number | null;
  ema200: number | null;
  rsi: number | null;
  dro: {
    rightmostCycleNumberBelowZero: boolean | null; // true = LOW pivot (bullish), false = HIGH (bearish)
    rightmostCycleNumber: number | null;
    mean: number | null;
    barsSincePivot: number | null;
  } | null;
  currentPrice: number | null;
  extractionConfidence: 'high' | 'medium' | 'low';
}

// ─── Agent 2 output: interpretation for one timeframe ───
export interface TimeframeAnalysisResult {
  timeframe: Timeframe;
  emaBias: 'bullish' | 'bearish' | 'neutral';
  emaGapClassification: 'tight' | 'moderate' | 'wide';
  emaGapPercent: number;
  rsiSignal: 'overbought' | 'oversold' | 'neutral';
  rsiValue: number | null;
  droBias: 'bullish' | 'bearish' | 'unclear';
  droCycleProgressPercent: number | null;
  overallBias: 'bullish' | 'bearish' | 'unclear';
  confidence: number; // 0-100
  summary: string;
  // Backward-compat flat fields (used by orchestrator to fill AnalysisResponse.analysis)
  ema: string;
  rsi: string;
  dro: string;
}

// ─── Agent 3 output: synthesis across all timeframes ───
export interface SynthesisResult {
  direction: Direction;
  probability: number;
  timeframeEstimate: string;
  conclusion: string;
  thesisFeedback: string;
  keyRisk: string;
}

// ─── Portfolio context sent by frontend ───
export interface PortfolioContext {
  portfolioSizeUsd: number;
  maxRiskPerTradePercent: number;
  totalTrades: number;
  winRate: number; // 0-1
  winRateByProbabilityBand: {
    '55-65': number | null;
    '65-75': number | null;
    '75+': number | null;
  };
  recentStreak: string; // e.g. "3 losses", "2 wins", "mixed"
}

// ─── Agent 4 output: trade strategy ───
export interface StrategyResult {
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  suggestedPositionSizeUsd: number | null;
  suggestedPositionSizePercent: number | null;
  tradeRecommendation: 'TAKE' | 'SKIP' | 'WAIT';
  recommendationReasoning: string;
}
```

- [ ] **Step 2: Extend `AnalysisRequest` to include portfolio context**

In `worker/src/types.ts`, add `portfolioContext?: PortfolioContext` to `AnalysisRequest`.

- [ ] **Step 3: Extend `AnalysisResponse` with new optional fields (backward-compatible)**

Add to `AnalysisResponse`:
```typescript
tradeRecommendation?: 'TAKE' | 'SKIP' | 'WAIT';
recommendationReasoning?: string;
suggestedPositionSizeUsd?: number;
suggestedPositionSizePercent?: number;
riskReward?: number;
extractions?: ChartExtraction[];
```

- [ ] **Step 4: Add `PortfolioContext` to `frontend/src/types.ts`** (mirror of worker type). Also extend `AnalysisRequest` in `frontend/src/types.ts` with `portfolioContext?: PortfolioContext`.

- [ ] **Step 5: Commit**
```bash
git add worker/src/types.ts frontend/src/types.ts
git commit -m "types: add multi-agent pipeline intermediate types and portfolio context"
```

---

### Task 2: ChartExtractionAgent (Agent 1 — Vision)

**Files:**
- Create: `worker/src/agents/extraction.ts`

The ChartExtractionAgent uses `gpt-4o` (vision). Its ONLY job is to read raw numbers from chart images — no interpretation, no prediction. It returns one `ChartExtraction` per chart.

- [ ] **Step 1: Create `worker/src/agents/extraction.ts`**

System prompt (pure OCR):
- Read EMA50/EMA200 from chart header legend line (first value = EMA200, second = EMA50)
- Read RSI from RSI legend crop image
- DRO pivot: if user-confirmed pivot given in text, use it (LOW → rightmostCycleNumberBelowZero: true, HIGH → false). Otherwise read from DRO crop: rightmost cycle number BELOW 0 axis → true, ABOVE → false, genuinely unclear → null
- DRO Mean: number from green "Mean: N" box
- barsSincePivot: count from rightmost turning point to right edge
- currentPrice: last candle close or rightmost price scale value
- extractionConfidence: "high" (all values readable), "medium" (1-2 uncertain), "low" (most null)
- Temperature: 0, max_tokens: 1500, response_format: json_object

Response JSON shape:
```json
{
  "charts": [
    {
      "timeframe": "4h",
      "ema50": 0.02981,
      "ema200": 0.03000,
      "rsi": 52.96,
      "dro": {
        "rightmostCycleNumberBelowZero": false,
        "rightmostCycleNumber": 40,
        "mean": 28,
        "barsSincePivot": 14
      },
      "currentPrice": 0.02988,
      "extractionConfidence": "high"
    }
  ]
}
```

Parse defensively — every field nullable, fall back to null on missing/wrong type. Timeframe comes from `screenshotsMeta[i].timeframe` if available, else from model output.

- [ ] **Step 2: Commit**
```bash
git add worker/src/agents/extraction.ts
git commit -m "feat: add ChartExtractionAgent (Agent 1, vision-only)"
```

---

### Task 3: TimeframeAnalysisAgent (Agent 2 — Text-Only)

**Files:**
- Create: `worker/src/agents/timeframe.ts`

Uses `gpt-4o-mini`. Receives a single `ChartExtraction` and returns a `TimeframeAnalysisResult`. Three instances run in parallel via `Promise.all` in the orchestrator.

- [ ] **Step 1: Create `worker/src/agents/timeframe.ts`**

User message is built from the `ChartExtraction` struct (no images — all values are already extracted). Include:
- EMA50, EMA200
- RSI value
- DRO direction (derived from rightmostCycleNumberBelowZero: true=LOW/bullish, false=HIGH/bearish, null=unclear)
- DRO Mean, barsSincePivot, computed cycleProgress = barsSincePivot/mean×100%
- extractionConfidence

System prompt rules:
- EMA gap = |EMA50-EMA200|/min×100, classify: tight <1%, moderate 1-3%, wide >3%
- RSI >70 = overbought, <30 = oversold, else neutral
- DRO cycle progress >100% = overdue for reversal, 80-100% = approaching pivot, <50% = mid-cycle
- Reduce confidence by 15 for each null value, by 20 if extractionConfidence is "low"
- DO NOT make a trade direction call — that is done by the synthesis agent

Response JSON shape matches `TimeframeAnalysisResult`. The flat `ema`, `rsi`, `dro` string fields are human-readable summaries used to fill `AnalysisResponse.analysis` for backward compatibility.

Temperature: 0.1, max_tokens: 600, response_format: json_object.

- [ ] **Step 2: Commit**
```bash
git add worker/src/agents/timeframe.ts
git commit -m "feat: add TimeframeAnalysisAgent (Agent 2, gpt-4o-mini, parallel-ready)"
```

---

### Task 4: SynthesisAgent (Agent 3 — Text-Only)

**Files:**
- Create: `worker/src/agents/synthesis.ts`

Uses `gpt-4o-mini`. Receives all three `TimeframeAnalysisResult` objects + userReasoning + pastLessons. Returns a `SynthesisResult`. Does NOT see any images.

- [ ] **Step 1: Create `worker/src/agents/synthesis.ts`**

User message format:
```
TIMEFRAME ANALYSES:

[4H]
  Overall bias: bearish (confidence: 74%)
  EMA: bearish, gap 1.16% (moderate)
  RSI: overbought (72.3)
  DRO: bearish, cycle 85% complete
  Summary: ...

[1H] ...
[15m] ...

USER'S THESIS:
...

PAST LESSONS FROM LOST TRADES:
• ETH/USDT LOWER (2026-01-12): "..."
```

System prompt rules:
- 4H carries most weight, 1H medium, 15m least (entry timing only)
- Require 2 of 3 TFs to agree for high-confidence call (>65%)
- 4H and 1H strong disagreement → UNCLEAR unless 15m breaks tie
- EMA exhaustion (wide gap) + DRO cycle >90% complete = strong reversal
- Past lessons: if setup matches a past losing pattern, name the match, reduce probability 10-15
- thesisFeedback: evaluate user reasoning per TF, agree/disagree with evidence
- probability = likelihood 0.5% move in predicted direction happens before 0.5% the other way
- Genuine conflict → UNCLEAR, probability 40-55%

Response JSON shape matches `SynthesisResult`. Temperature: 0.15, max_tokens: 800.

- [ ] **Step 2: Commit**
```bash
git add worker/src/agents/synthesis.ts
git commit -m "feat: add SynthesisAgent (Agent 3, gpt-4o-mini, learns from past losses)"
```

---

### Task 5: StrategyAgent (Agent 4 — Text-Only)

**Files:**
- Create: `worker/src/agents/strategy.ts`

Uses `gpt-4o-mini`. Receives `SynthesisResult` + symbol + currentPrice + optional `PortfolioContext`. Returns `StrategyResult` with precise trade levels, R:R, TAKE/SKIP/WAIT recommendation, and position sizing.

- [ ] **Step 1: Create `worker/src/agents/strategy.ts`**

User message includes:
- synthesis direction, probability, timeframeEstimate, keyRisk
- symbol, currentPrice (from Agent 1 extraction, fallback to symbol-appropriate default)
- If portfolioContext provided: portfolioSizeUsd, maxRiskPerTradePercent, totalTrades, winRate, historical win rate for relevant probability band (55-65, 65-75, 75+), recentStreak

System prompt rules:
- SL: 0.4-0.6% from entry
- TP: 0.5-0.7% from entry, target R:R ≥ 1.0
- ETHBTC: 5 decimal places, 0.5% move ≈ 0.00013
- tradeRecommendation:
  - TAKE: probability ≥ 65% AND R:R ≥ 1.0 AND (no portfolio OR historical win rate for band ≥ 50% OR overall winRate ≥ 50%)
  - SKIP: probability < 60% OR direction UNCLEAR OR historical win rate for band < 40%
  - WAIT: between TAKE and SKIP — marginal (e.g. prob 62%, R:R 0.9, losing streak)
- Position sizing (only if portfolioSizeUsd provided):
  - maxRisk$ = portfolioSizeUsd × (maxRiskPerTradePercent/100)
  - positionSize$ = maxRisk$ / (stopLoss distance as % of entry)
  - If recentStreak is "3+ losses" OR band win rate < 50%: reduce position by 50%
  - Cap at 10% of portfolio
- suggestedPositionSizeUsd and suggestedPositionSizePercent: null if no portfolioSizeUsd

Temperature: 0.1, max_tokens: 600.

- [ ] **Step 2: Commit**
```bash
git add worker/src/agents/strategy.ts
git commit -m "feat: add StrategyAgent (Agent 4, portfolio-aware, TAKE/SKIP/WAIT)"
```

---

### Task 6: Pipeline Orchestrator

**Files:**
- Create: `worker/src/agents/orchestrator.ts`

The orchestrator chains all four agents and maps output to the existing `AnalysisResponse` shape (backward-compatible), extended with new optional fields.

- [ ] **Step 1: Create `worker/src/agents/orchestrator.ts`**

Pipeline sequence:
1. `ChartExtractionAgent.extract(req)` — one call, all images
2. `Promise.all(extractions.map(e => TimeframeAnalysisAgent.analyze(e)))` — parallel
3. `SynthesisAgent.synthesize(tfAnalyses, req.userReasoning, req.pastLessons ?? [])` — one call
4. `StrategyAgent.plan(synthesis, req.symbol, latestPrice, req.portfolioContext)` — one call
   - `latestPrice`: take from `extractions.find(e => e.currentPrice != null)?.currentPrice ?? null`

Map to `AnalysisResponse`:
- Build `tfAnalysisMap: Record<Timeframe, TimeframeAnalysis>` from `tfAnalyses` (using `.ema`, `.rsi`, `.dro` flat strings)
- Fill missing timeframes with `{ ema: 'N/A', rsi: 'N/A', dro: 'N/A' }`
- Build `reasoning` string: join per-TF summaries + `Conclusion: ${synthesis.conclusion}`
- New optional fields: `tradeRecommendation`, `recommendationReasoning`, `suggestedPositionSizeUsd`, `suggestedPositionSizePercent`, `riskReward`, `extractions`

Export a `PipelineError` class extending `Error` for pipeline-specific failures.

- [ ] **Step 2: Commit**
```bash
git add worker/src/agents/orchestrator.ts
git commit -m "feat: add AnalysisPipelineOrchestrator (chains all 4 agents)"
```

---

### Task 7: Wire Orchestrator into Worker Endpoint

**Files:**
- Modify: `worker/src/index.ts`
- Modify: `worker/src/validate.ts`

- [ ] **Step 1: Update `worker/src/validate.ts` to accept optional `portfolioContext`**

After existing `pastLessons` validation, add validation for `portfolioContext` (optional):
- If present: `portfolioSizeUsd` must be a positive number
- `maxRiskPerTradePercent` must be a number between 0 and 100 (exclusive of 0, inclusive of 100)
- Other fields (`totalTrades`, `winRate`, band rates, `recentStreak`) are computed on frontend and accepted as-is

- [ ] **Step 2: Replace `AnalysisAgent` with `AnalysisPipelineOrchestrator` in `worker/src/index.ts`**

Remove import of `AnalysisAgent`/`AnalysisError`. Import `AnalysisPipelineOrchestrator`/`PipelineError`. In the `/api/analyze` handler, instantiate `new AnalysisPipelineOrchestrator(apiKey)` and call `.run(request)`. Update catch block to handle `PipelineError` with status 502.

- [ ] **Step 3: Commit**
```bash
git add worker/src/index.ts worker/src/validate.ts
git commit -m "feat: wire AnalysisPipelineOrchestrator into /api/analyze endpoint"
```

---

### Task 8: Frontend — Portfolio Context Computation

**Files:**
- Modify: `frontend/src/App.tsx`

Add portfolio settings state and the function that computes `PortfolioContext` from `StoredAnalysis[]` history.

- [ ] **Step 1: Add `portfolioSizeUsd` and `maxRiskPercent` state to `App.tsx`**

Both persisted in localStorage (`'portfolio-size'` and `'portfolio-risk'`). Default: 0 and 2 respectively. Persist on change with `useEffect`.

- [ ] **Step 2: Add `computePortfolioContext()` function in `App.tsx`**

Returns `PortfolioContext | undefined`. Returns `undefined` if `portfolioSizeUsd <= 0`.

Computes:
- `completed` = history filtered to `outcome === 'won' | 'lost'`
- `winRate` = won / completed.length (0 if no completed trades)
- Band win rates: filter completed by `probability` range (55-65, 65-75, 75+), return null if fewer than 3 trades in band
- `recentStreak`: check last 5 completed trades — if ≥3 losses → "N losses", if ≥3 wins → "N wins", else "mixed"
- Return full `PortfolioContext` object

- [ ] **Step 3: Pass `portfolioContext` in `handleAnalyze`**

After building `enrichedReq`, compute `portfolioContext = computePortfolioContext()` and add to final request if defined.

- [ ] **Step 4: Pass setters as props to `AnalysisForm`**

Add `portfolioSizeUsd`, `maxRiskPercent`, `onPortfolioSizeChange`, `onMaxRiskPercentChange` props to `AnalysisForm`.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/App.tsx
git commit -m "feat: compute and pass portfolio context from trade history to analysis request"
```

---

### Task 9: Frontend — Portfolio Inputs in AnalysisForm

**Files:**
- Modify: `frontend/src/components/AnalysisForm.tsx`

Add portfolio size and max risk % inputs. These are optional — the section is labeled "(optional — enables position sizing)".

- [ ] **Step 1: Add new props to `AnalysisFormProps`**

```typescript
portfolioSizeUsd: number;
maxRiskPercent: number;
onPortfolioSizeChange: (v: number) => void;
onMaxRiskPercentChange: (v: number) => void;
```

- [ ] **Step 2: Add portfolio inputs section to form JSX**

Add above the Submit button. Two side-by-side inputs:
- "Portfolio size ($)" — number input, min=0, step=100, placeholder "e.g. 10000"
- "Max risk %" — number input, min=0.1, max=10, step=0.1

Both styled consistently with existing inputs (same `bg-gray-900 border border-gray-600 rounded-lg` pattern).

- [ ] **Step 3: Commit**
```bash
git add frontend/src/components/AnalysisForm.tsx
git commit -m "feat: add portfolio size and max risk inputs to AnalysisForm"
```

---

### Task 10: Frontend — Show Strategy Recommendation in Results

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/components/AnalysisResult.tsx`

- [ ] **Step 1: Extend `AnalysisResponse` in `frontend/src/types.ts`**

Add optional fields:
```typescript
tradeRecommendation?: 'TAKE' | 'SKIP' | 'WAIT';
recommendationReasoning?: string;
suggestedPositionSizeUsd?: number;
suggestedPositionSizePercent?: number;
riskReward?: number;
```

- [ ] **Step 2: Add recommendation banner to `AnalysisResult.tsx`**

Read the existing file first to find the correct insertion point (before the levels/entry section). Add a block that renders when `analysis.tradeRecommendation` is defined:
- TAKE: green background, "✅ TAKE TRADE"
- SKIP: red background, "🚫 SKIP"
- WAIT: yellow background, "⏳ WAIT"
- Show R:R if available
- Show `recommendationReasoning` text
- Show suggested position size in $ and % if available

- [ ] **Step 3: Commit**
```bash
git add frontend/src/types.ts frontend/src/components/AnalysisResult.tsx
git commit -m "feat: show TAKE/SKIP/WAIT recommendation and position sizing in results"
```

---

### Task 11: Cleanup

**Files:**
- Delete: `worker/src/agents/analysis.ts`

- [ ] **Step 1: Verify worker builds cleanly without `analysis.ts`**

```bash
cd worker && npm run build
```

Expected: exit 0, no TypeScript errors.

- [ ] **Step 2: Delete old agent and commit**

```bash
git rm worker/src/agents/analysis.ts
git commit -m "chore: remove monolithic AnalysisAgent (replaced by 4-agent pipeline)"
```

---

## Scope Check

| Requirement | Task |
|---|---|
| Extract data from chart images (Agent 1) | Task 2 |
| Per-chart analysis per timeframe in parallel (Agent 2) | Task 3 |
| Cross-timeframe synthesis + conclusion (Agent 3) | Task 4 |
| Trade strategy + TAKE/SKIP/WAIT (Agent 4) | Task 5 |
| Pipeline orchestration with parallelism | Task 6 |
| Backward-compatible API endpoint | Task 7 |
| Portfolio management (size, risk %, position sizing) | Tasks 5, 8, 9 |
| Learning from past losses — qualitative (pastLessons) | Task 4 (SynthesisAgent) |
| Learning from past losses — quantitative (win rates by band) | Task 8 (computePortfolioContext) |
| Frontend portfolio inputs | Task 9 |
| Frontend recommendation display | Task 10 |
| Mixed models (gpt-4o vision / gpt-4o-mini text) | Tasks 2, 3, 4, 5 |
| Remove old monolithic agent | Task 11 |
