# Trading Agent — Scalp Prediction Tool

A scalp-trade prediction tool that uses GPT-4o (vision) to analyze chart screenshots, your reasoning, and indicator values to predict whether price will move up or down by 0.5%.

## How It Works

```
You look at TradingView chart
    ↓
Upload screenshot(s) + write your thesis + (optional) indicator values
    ↓
Click "Predict 0.5% Move"
    ↓
GPT-4o analyzes chart images + your reasoning
    ↓
You get: Direction · Probability · Timeframe · Risk · Levels + Feedback on your thesis
```

## Features

- **Chart screenshot analysis** — GPT-4o vision reads your candlestick charts, indicators, support/resistance
- **Your thesis as input** — Write what you see and get honest AI feedback (agree/disagree)
- **Scalp-focused** — Predictions target ±0.5% moves with tight stop-losses
- **Optional indicator values** — PPO and trend direction across 3 timeframes
- **History** — Last 10 predictions stored in localStorage

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | Vite + React + TypeScript + Tailwind CSS |
| Backend | Cloudflare Worker + Hono |
| AI Model | OpenAI GPT-4o (vision-capable) |
| Storage | localStorage (frontend only) |

## Project Structure

```
trading-agent/
├── frontend/
│   └── src/
│       ├── App.tsx
│       ├── types.ts
│       └── components/
│           ├── AnalysisForm.tsx    # Screenshots + reasoning + indicators
│           ├── AnalysisResult.tsx  # Prediction display
│           └── HistoryList.tsx     # Past predictions
├── worker/
│   └── src/
│       ├── index.ts               # Hono API
│       ├── types.ts               # Shared types
│       ├── validate.ts            # Request validation
│       └── agents/
│           └── analysis.ts        # GPT-4o vision agent
└── README.md
```

## Getting Started

### Prerequisites

- Node.js 20+ (`nvm use 20`)
- OpenAI API key (needs GPT-4o access)

### Backend

```bash
cd worker
cp .dev.vars.example .dev.vars
# Edit .dev.vars → add your OPENAI_API_KEY
npm install
npm run dev          # runs on http://localhost:8787
```

### Frontend

```bash
cd frontend
npm install
npm run dev          # runs on http://localhost:5173
```

The frontend proxies `/api/*` to the worker at `localhost:8787`.

## Chart Capture (Optional)

1. One-time setup: launch Chrome with remote debugging enabled:
   ```bash
   ./capture/launch-chrome.sh
   ```
2. Start the capture server:
   ```bash
   cd capture && npm run dev
   ```
3. Open TradingView with your chart layout in Chrome.
4. Click "Capture from TradingView" in the Trading-Agent app.

## API

### POST /api/analyze

```json
{
  "symbol": "ETHUSDT",
  "screenshots": ["data:image/png;base64,..."],
  "userReasoning": "PPO crossing up on 1m, trend aligning bullish...",
  "indicators": {
    "ppo": { "1m": 2.5, "15m": 3.1, "30m": 2.8 },
    "trend": { "1m": "bullish", "15m": "bullish", "30m": "bullish" },
    "aligned": true
  }
}
```

**Response:**
```json
{
  "direction": "HIGHER",
  "probability": 72,
  "timeframeEstimate": "5-15 minutes",
  "reasoning": "Strong momentum alignment across timeframes...",
  "thesisFeedback": "Agree — the PPO crossover confirms bullish pressure...",
  "keyRisk": "If price breaks below the 15m support at $2,480...",
  "levels": { "entry": 2500, "stopLoss": 2488, "takeProfit": 2513 },
  "timestamp": "2026-02-04T22:30:00.000Z"
}
```

## Deployment

```bash
# Frontend → Cloudflare Pages
cd frontend && npm run build

# Worker → Cloudflare Workers
cd worker
npx wrangler secret put OPENAI_API_KEY
npx wrangler deploy
```
