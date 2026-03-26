# TradingView Auto-Capture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Capture Charts" button to the Trading-Agent app that automatically screenshots the user's TradingView charts (4H, 1H, 15m) from their running Chrome session via Playwright CDP, eliminating the manual download-and-drag workflow.

**Architecture:** A small local Node.js + Express server (`capture/`) runs alongside the existing frontend and worker. It connects to the user's Chrome via CDP on port 9222, finds the TradingView chart tab, cycles through 3 timeframes (4H → 1H → 15m), takes a `page.screenshot()` at each, and returns 3 base64 data URLs. The frontend adds a "Capture Charts" button to `AnalysisForm.tsx` that calls this server, populates the existing `screenshots` state, and flows into the normal analysis pipeline unchanged.

**Tech Stack:** Node.js, Express, Playwright (CDP mode), TypeScript. Frontend: React (existing).

---

### Task 1: Scaffold the Capture Server Package

**Files:**
- Create: `capture/package.json`
- Create: `capture/tsconfig.json`
- Modify: `.gitignore`

**Step 1: Create `capture/package.json`**

```json
{
  "name": "trading-agent-capture",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "start": "tsx src/server.ts"
  }
}
```

**Step 2: Install dependencies**

```bash
cd capture
npm install express playwright
npm install -D tsx typescript @types/express @types/node
```

Note: `playwright` here is used only for its CDP connection API — no browsers are installed, no `npx playwright install` needed, because we connect to the user's existing Chrome.

**Step 3: Create `capture/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

**Step 4: Add `capture/node_modules` to root `.gitignore`**

Append `capture/node_modules` to the existing `.gitignore`.

**Step 5: Commit**

```bash
git add capture/ .gitignore
git commit -m "feat(capture): scaffold capture server package"
```

---

### Task 2: Implement the Core Screenshot Logic

**Files:**
- Create: `capture/src/capture.ts`

**Step 1: Create `capture/src/capture.ts`**

```typescript
import { chromium, type Page } from 'playwright';

export interface CaptureOptions {
  symbol?: string;
  cdpUrl?: string;
}

export interface CaptureResult {
  screenshots: string[];       // base64 data URLs, ordered [4H, 1H, 15m]
  timeframes: string[];        // ["4h", "1h", "15m"]
}

const TIMEFRAMES = [
  { label: '4h', selector: '[data-value="240"]' },
  { label: '1h', selector: '[data-value="60"]' },
  { label: '15m', selector: '[data-value="15"]' },
];

const CHART_RENDER_WAIT_MS = 3000;

export async function captureCharts(options: CaptureOptions = {}): Promise<CaptureResult> {
  const cdpUrl = options.cdpUrl ?? 'http://localhost:9222';

  const browser = await chromium.connectOverCDP(cdpUrl);

  try {
    const tvPage = await findTradingViewTab(browser);

    if (!tvPage) {
      throw new Error(
        'No TradingView chart tab found. Make sure you have tradingview.com/chart open in Chrome.'
      );
    }

    await tvPage.bringToFront();

    const screenshots: string[] = [];

    for (const tf of TIMEFRAMES) {
      await switchTimeframe(tvPage, tf.selector, tf.label);
      await tvPage.waitForTimeout(CHART_RENDER_WAIT_MS);

      const chartEl = await tvPage.$('.chart-markup-table');
      const buffer = chartEl
        ? await chartEl.screenshot()
        : await tvPage.screenshot();

      const base64 = `data:image/png;base64,${buffer.toString('base64')}`;
      screenshots.push(base64);
    }

    return {
      screenshots,
      timeframes: TIMEFRAMES.map((tf) => tf.label),
    };
  } finally {
    browser.close();
  }
}

async function findTradingViewTab(
  browser: Awaited<ReturnType<typeof chromium.connectOverCDP>>
): Promise<Page | null> {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (page.url().includes('tradingview.com/chart')) {
        return page;
      }
    }
  }
  return null;
}

async function switchTimeframe(page: Page, selector: string, label: string): Promise<void> {
  const btn = await page.$(selector);
  if (btn) {
    await btn.click();
    return;
  }
  // Fallback: open the timeframe dropdown and search
  const dropdownTrigger = await page.$('#header-toolbar-intervals');
  if (dropdownTrigger) {
    await dropdownTrigger.click();
    await page.waitForTimeout(300);
    const option = await page.$(selector);
    if (option) {
      await option.click();
      return;
    }
  }
  throw new Error(`Could not find timeframe button for ${label}`);
}
```

**Important:** The TradingView DOM selectors (`data-value="240"`, `.chart-markup-table`) need to be verified against the actual TradingView page during Task 8. These are commonly used selectors but TradingView updates their DOM periodically.

Note: `browser.close()` when connected via CDP only disconnects Playwright — it does NOT close Chrome.

**Step 2: Commit**

```bash
git add capture/src/capture.ts
git commit -m "feat(capture): core screenshot capture logic with CDP"
```

---

### Task 3: Implement the HTTP Server

**Files:**
- Create: `capture/src/server.ts`

**Step 1: Create `capture/src/server.ts`**

```typescript
import express from 'express';
import { captureCharts } from './capture.js';

const app = express();
const PORT = 3001;

app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/capture', async (req, res) => {
  const symbol = (req.query.symbol as string) ?? 'ETHUSDT';

  try {
    const result = await captureCharts({ symbol });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Capture failed';
    console.error('Capture error:', message);
    res.status(500).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`Capture server running on http://localhost:${PORT}`);
});
```

**Step 2: Verify the server starts**

```bash
cd capture && npm run dev
```

Expected: `Capture server running on http://localhost:3001`

(It won't capture without Chrome's debug port — just verify startup.)

**Step 3: Commit**

```bash
git add capture/src/server.ts
git commit -m "feat(capture): express HTTP server with /capture endpoint"
```

---

### Task 4: Add the Vite Proxy for the Capture Server

**Files:**
- Modify: `frontend/vite.config.ts`

**Step 1: Add `/capture` proxy rule**

Add a new proxy entry so the frontend can call `/capture` without CORS issues, alongside the existing `/api` and `/binance` proxies:

```typescript
'/capture': {
  target: 'http://localhost:3001',
  changeOrigin: true,
},
```

**Step 2: Commit**

```bash
git add frontend/vite.config.ts
git commit -m "feat(capture): proxy /capture to local capture server"
```

---

### Task 5: Add "Capture Charts" Button to AnalysisForm

**Files:**
- Modify: `frontend/src/components/AnalysisForm.tsx`

**Step 1: Add capture state and handler**

Add to the component, after the existing state declarations:

```typescript
const [capturing, setCapturing] = useState(false);

const handleCapture = useCallback(async () => {
  setCapturing(true);
  try {
    const res = await fetch(`/capture/capture?symbol=${symbol}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error ?? `Capture failed (${res.status})`);
    }
    const data: { screenshots: string[] } = await res.json();
    if (data.screenshots.length === 0) {
      throw new Error('No screenshots returned');
    }
    setScreenshots(data.screenshots.slice(0, MAX_SCREENSHOTS));
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Failed to capture charts');
  } finally {
    setCapturing(false);
  }
}, [symbol]);
```

**Step 2: Add the button in the UI**

Place it directly above the drop zone `div`, inside the "Chart Screenshots" label section. Style it consistently with the app's dark theme. When `capturing` is true, show a spinner and text "Capturing... (4H → 1H → 15m)". When screenshots are already at max (3), disable it.

Default button text: "Capture from TradingView" with a camera icon.

**Step 3: Verify it compiles**

```bash
cd frontend && npm run build
```

Expected: Build succeeds with no type errors.

**Step 4: Commit**

```bash
git add frontend/src/components/AnalysisForm.tsx
git commit -m "feat(capture): add Capture from TradingView button to form"
```

---

### Task 6: Create Chrome Launch Helper Script

**Files:**
- Create: `capture/launch-chrome.sh`

**Step 1: Create the script**

```bash
#!/bin/bash
# Launch Chrome with remote debugging enabled for Playwright CDP connection.
# Run this ONCE instead of opening Chrome normally.
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  "$@"
```

**Step 2: Make executable**

```bash
chmod +x capture/launch-chrome.sh
```

**Step 3: Commit**

```bash
git add capture/launch-chrome.sh
git commit -m "feat(capture): Chrome launch helper with CDP port"
```

---

### Task 7: Add Startup Instructions to README

**Files:**
- Modify: `README.md`

**Step 1: Add a "Chart Capture (Optional)" section** to the README with:

1. One-time setup: Launch Chrome with `./capture/launch-chrome.sh`
2. Start the capture server: `cd capture && npm run dev`
3. Open TradingView with your chart layout in Chrome
4. Click "Capture from TradingView" in the Trading-Agent app

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add chart capture setup instructions"
```

---

### Task 8: Selector Verification and Tuning

**Files:**
- Possibly modify: `capture/src/capture.ts`

This is the manual testing step:

1. Ensure Chrome is running with `--remote-debugging-port=9222`
2. Ensure a TradingView chart tab is open
3. Start the capture server (`cd capture && npm run dev`)
4. Start the frontend (`cd frontend && npm run dev`)
5. Click "Capture from TradingView" and check:
   - Does it find the TradingView tab?
   - Do the timeframe buttons get clicked correctly?
   - Are the screenshots captured properly (chart area, not full page)?
   - Do the 3 thumbnails appear in the form?

If selectors are wrong, update them in `capture/src/capture.ts`. TradingView's DOM can vary, so this step is critical.

**Commit if changes were needed:**

```bash
git add -A
git commit -m "fix(capture): tune TradingView selectors after testing"
```

---

## Summary of New/Modified Files

| Action | File |
|---|---|
| Create | `capture/package.json` |
| Create | `capture/tsconfig.json` |
| Create | `capture/src/capture.ts` |
| Create | `capture/src/server.ts` |
| Create | `capture/launch-chrome.sh` |
| Modify | `frontend/vite.config.ts` (add proxy) |
| Modify | `frontend/src/components/AnalysisForm.tsx` (add button) |
| Modify | `.gitignore` (add `capture/node_modules`) |
| Modify | `README.md` (add setup instructions) |

## Running the Full Stack After Implementation

```
Terminal 1:  ./capture/launch-chrome.sh          (Chrome with CDP)
Terminal 2:  cd capture && npm run dev            (Capture server :3001)
Terminal 3:  cd worker && npm run dev             (Hono worker :8787)
Terminal 4:  cd frontend && npm run dev           (Vite :5173)
```
