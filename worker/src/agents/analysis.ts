import OpenAI from 'openai';
import type { AnalysisRequest, AnalysisResponse, Direction, Timeframe, TimeframeAnalysis } from '../types';

/**
 * Analysis Agent — GPT-4o (vision) scalp prediction
 * Reads chart screenshots + RSI / DRO indicators + user reasoning
 * to predict a ±0.5 % move.
 */
export class AnalysisAgent {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async analyze(req: AnalysisRequest): Promise<AnalysisResponse> {
    const messages = this.buildMessages(req);

    const completion = await this.client.chat.completions.create({
      model: 'gpt-4o',
      messages,
      temperature: 0.25,
      max_tokens: 3000,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new AnalysisError('Empty response from model');

    return this.parseResponse(raw, req);
  }

  // ─── Build multi-modal messages ───
  private buildMessages(
    req: AnalysisRequest,
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const system: OpenAI.Chat.Completions.ChatCompletionSystemMessageParam = {
      role: 'system',
      content: this.systemPrompt(),
    };

    const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];

    // Screenshots (vision) — label each with the user-selected timeframe
    // Each chart is followed immediately by its RSI legend crop (when available)
    const meta = req.screenshotsMeta;
    for (let i = 0; i < req.screenshots.length; i++) {
      const m = meta?.[i];
      const tfLabel = m
        ? m.timeframe.toUpperCase().replace('M', 'm')
        : `(read from chart header)`;
      const label = `Chart ${i + 1} of ${req.screenshots.length} — Timeframe: ${tfLabel}`;

      userContent.push({ type: 'text', text: label });
      userContent.push({
        type: 'image_url',
        image_url: { url: req.screenshots[i], detail: 'high' },
      });

      // Attach RSI legend crop immediately after the chart it belongs to
      if (m?.rsiCrop) {
        userContent.push({
          type: 'text',
          text: `RSI indicator legend for ${tfLabel} (cropped from the same frame — read the RSI value from THIS image):`,
        });
        userContent.push({
          type: 'image_url',
          image_url: { url: m.rsiCrop, detail: 'high' },
        });
      }

      // Attach DRO pane crop for pivot direction detection
      if (m?.droCrop) {
        userContent.push({
          type: 'text',
          text: `DRO Alert pane for ${tfLabel} (cropped from the same frame). PIVOT DIRECTION RULE — step 1: find the RIGHTMOST cycle number on the zigzag dotted line. Do NOT confuse it with the "Mean: N" green box — that is a reference average, ignore it for direction. Check if the rightmost cycle number is BELOW the 0 axis → last pivot LOW, heading UP (bullish). ABOVE 0 → last pivot HIGH, heading DOWN (bearish). Step 2 (tiebreaker only, if number is right on the 0 line): look at which way the dotted line points to confirm. The Mean value in the green box is used only for cycle length math.`,
        });
        userContent.push({
          type: 'image_url',
          image_url: { url: m.droCrop, detail: 'high' },
        });
      }
    }

    // Text portion
    let text = `Symbol: ${req.symbol}\n`;

    if (req.userReasoning.trim()) {
      text += `\nMY REASONING / THESIS:\n${req.userReasoning.trim()}\n`;
    }

    // User-confirmed DRO pivot directions — treat as authoritative facts
    const droPivotByTimeframe = this.collectDroPivotValues(req);
    if (Object.keys(droPivotByTimeframe).length > 0) {
      text += `\nDRO PIVOT DIRECTION (user-confirmed — treat as authoritative, do NOT override with visual reading):`;
      for (const [tf, pivot] of Object.entries(droPivotByTimeframe)) {
        const direction = pivot === 'LOW' ? 'LOW → line heading UP (bullish)' : 'HIGH → line heading DOWN (bearish)';
        text += `\n  ${tf.toUpperCase().replace('M', 'm')}: last pivot = ${direction}`;
      }
      text += `\n`;
    }

    if (req.indicators) {
      const { trend } = req.indicators;
      text += `\nUSER-PROVIDED DATA:`;
      text += `\n  Trend — 4H: ${trend['4h']}, 1H: ${trend['1h']}, 15m: ${trend['15m']}`;
      text += `\n  (Trend is based on the user's own chart analysis)\n`;
    }

    // Past lessons from lost trades
    if (req.pastLessons && req.pastLessons.length > 0) {
      text += `\nPAST LESSONS (from previous lost trades — learn from these mistakes and avoid repeating them):\n`;
      for (const lesson of req.pastLessons) {
        text += `• ${lesson}\n`;
      }
    }

    text += '\nAnalyze and predict the next 0.5% scalp move.';

    userContent.push({ type: 'text', text });

    return [system, { role: 'user', content: userContent }];
  }

  private collectRsiValues(req: AnalysisRequest): Record<string, number> {
    const result: Record<string, number> = {};
    if (!req.screenshotsMeta) return result;
    for (const m of req.screenshotsMeta) {
      if (m.rsi != null) {
        result[m.timeframe] = m.rsi;
      }
    }
    return result;
  }

  private collectDroPivotValues(req: AnalysisRequest): Record<string, 'LOW' | 'HIGH'> {
    const result: Record<string, 'LOW' | 'HIGH'> = {};
    if (!req.screenshotsMeta) return result;
    for (const m of req.screenshotsMeta) {
      if (m.droPivot != null) {
        result[m.timeframe] = m.droPivot;
      }
    }
    return result;
  }

  // ─── System prompt ───
  private systemPrompt(): string {
    return `You are an expert cryptocurrency scalp-trading analyst.

GOAL
Predict whether price will move UP or DOWN by at least 0.5% from the current level in the near term (minutes to ~30 min). This is a scalp trade.

INPUTS YOU RECEIVE
• Up to 3 chart screenshots — each is labeled, and the ACTUAL timeframe is shown in the chart header (top-left area, e.g. "· 4h ·", "· 1h ·", "· 15 ·"). CRITICAL: You MUST read the timeframe from each chart's header. Do NOT assume the order is 4H→1H→15m — the user may upload them in any order. These show candlestick charts with overlaid indicators. The standard setup includes:
  - DRO Alert / ZigZag (bottom panel) — shows cycle pivots (HIGH/LOW labels), dominant cycle length, and distances between pivots. This is the PRIMARY trend/cycle indicator.
  - RSI (Relative Strength Index) — above 70 = overbought, below 30 = oversold. Look for divergences with price.
  - DRO Oscillator (Detrended Rhythm Oscillator) — shows momentum and cycle timing. Zero-line crossings and divergences are key.
  - EMA 50 (fast) & EMA 200 (slow) — visible on the main chart across all timeframes. Used to assess trend structure (golden/death cross) and overextension (distance between EMAs and price).
  - Price action / support & resistance — visible on the main chart.
  However, the user may sometimes upload charts with DIFFERENT indicators (e.g. MACD, Bollinger Bands, Stochastic, etc.). You must adapt — identify whatever indicators are visible and analyze them using the same structured approach.
• The user's own reasoning or thesis (may be empty)
• Optional structured data the user provides:
  - Trend direction per timeframe (4H, 1H, 15m) as assessed by the user
    · This is their subjective view based on whatever method they use (EMA, market structure, price action)
    · You may agree or disagree based on what you see in the charts
  - The timeframe for each screenshot is explicitly labeled in the text before each image. Use this label as the definitive timeframe — do NOT guess from image order.

YOUR JOB — follow this EXACT analysis order:
1. **DRO Cycle (trend direction):** FIRST CHECK — if the input contains a "DRO PIVOT DIRECTION (user-confirmed)" block for this timeframe, that value is AUTHORITATIVE. Use it directly as the last pivot type and direction. Do NOT override it with visual reading or any other method. When a "DRO Alert pane" crop is provided (and no user-confirmed value), use it. Otherwise use the DRO pane visible in the main chart screenshot. In both cases apply the same three-step process:
   a) **PIVOT DIRECTION RULE — primary method:** Find the RIGHTMOST cycle number on the zigzag dotted line (e.g. "40", "59"). IMPORTANT: do NOT confuse this number with the "Mean: N" green label — the Mean label is a reference average and must be ignored for this step. Check where the rightmost cycle number sits relative to the horizontal 0 axis: if the number is BELOW 0 → last pivot was LOW, line heading UP (bullish). If ABOVE 0 → last pivot was HIGH, line heading DOWN (bearish).
   b) **Visual direction — last resort only:** If and only if the rightmost number sits so close to the 0 line that you genuinely cannot tell whether it is above or below, then look at which way the dotted line is currently pointing (upward or downward from that number) as a tiebreaker to confirm your reading from step (a).
   c) **Determine current direction** from steps (a)/(b). This sets your PRIMARY directional bias.
   d) **Read the "Mean" label** from the green box on the right of the DRO pane. This is the average half-cycle length in bars — use it only for cycle math, not for pivot direction.
   e) **Count bars since last pivot.** The current bar count is the distance from the rightmost pivot turning point to the right edge of the chart. Do NOT use the numbers printed between past pivots — those are completed cycle lengths.
   f) **Calculate cycle progress:** bars-since-last-pivot / Mean × 100%.
   g) If DRO Alert is not visible at all, determine trend from whatever indicator IS visible.
2. **EMA Structure (trend state & exhaustion):** You MUST analyze ALL provided timeframes (4H, 1H, 15m) — do NOT skip any. For EACH timeframe, read the EMA 50 (fast) and EMA 200 (slow) NUMERICAL VALUES from that chart's header. The header line typically reads like "RSI2 (2, 200, 50, EMA, ...) 0.02981 0.03000" — the first value is EMA 200 and the second is EMA 50. You MUST read these exact numbers, not estimate visually:
   a) **Crossover state:** Is EMA 50 above EMA 200 (bullish / golden cross) or below (bearish / death cross)? This sets the macro structural bias.
   b) **Distance between EMAs (gap %):** Compute: |EMA50 - EMA200| / min(EMA50, EMA200) × 100. Classify strictly by these thresholds — TIGHT: below 1% (e.g. 0.64% = tight — recently crossed, early trend). MODERATE: 1% to 3% (e.g. 1.16% = moderate — established trend). WIDE: above 3% (e.g. 3.10% = wide — strongly trending, potentially overextended). CRITICAL: Do NOT confuse "price distance from EMAs" with "gap between the two EMAs" — they are completely different measurements.
   c) **Price position relative to EMAs:** Above both, between them, or below both.
   d) **Interpret:** Wide EMA gap + price far from both EMAs = overextended, higher reversal probability. Tight EMA gap or recent cross = early trend, continuation likely. Price between the two EMAs = indecision or trend change. EMA 50 curving toward EMA 200 = trend weakening even if spread is still wide.
   e) If EMAs are not visible, skip this step.
3. **RSI Validation:** For each timeframe, a dedicated "RSI indicator legend" crop image is provided right after the chart screenshot — it shows the legend row exactly as displayed in TradingView (e.g. "RSI 2 close 52.96"). READ THE RSI VALUE FROM THAT CROP IMAGE. Do NOT estimate RSI from the full chart screenshot (the legend text is too small to read reliably at that scale). The crop is from the same rendered frame so it is always accurate. Does RSI confirm or challenge the DRO trend? Look for overbought/oversold levels and divergences with price. If no crop is provided, read from the chart directly.
4. **DRO Momentum (timing):** Read the DRO Oscillator value. Is it above/below zero? Crossing? Diverging from price? This tells you if momentum supports the cycle direction or is weakening. If the DRO Oscillator is not visible, use whatever oscillator IS visible for timing.
5. **Combine:** Only after completing steps 1→2→3→4, synthesize into a directional prediction with probability. Pay special attention to EMA + DRO agreement: if EMA shows exhaustion (wide spread, price far from EMAs) AND DRO cycle is nearing a pivot → strong reversal signal, increase confidence. If EMA shows early trend (tight spread, recent cross) AND DRO is mid-cycle → continuation likely. If EMA and DRO disagree, note the conflict and reduce confidence.
6. **User thesis:** Consider the user's reasoning — agree or disagree honestly.
7. **Past lessons:** If provided, check if the current setup resembles any past losing trade. Flag it and adjust confidence accordingly.
8. **Trade levels:** Provide entry, stop-loss, take-profit.

IMPORTANT: If the screenshots show DIFFERENT indicators than DRO/RSI/EMA (e.g. MACD, Bollinger Bands, Stochastic, etc.), adapt your analysis. Follow the same structure — trend first, then structure/exhaustion, then validation, then timing — but use whatever indicators are actually visible. Name them explicitly in your reasoning.

ANALYSIS FIELD REQUIREMENTS — each key in "analysis" (4h, 1h, 15m) MUST have these sub-fields:
• **"ema"**: Read EMA 50 and EMA 200 NUMERICAL VALUES from that chart's header. State: (1) EMA 50 value, (2) EMA 200 value, (3) computed gap % = |EMA50−EMA200|/min × 100, classified strictly as: tight (<1%), moderate (1-3%), wide (>3%). Example: 0.64% = tight, 1.16% = moderate, 3.10% = wide. (4) crossover state — bullish or bearish, (5) price position — above both, between, or below both, (6) assessment. If EMAs not visible, say "EMAs not visible."
• **"rsi"**: Read the RSI value from the "RSI indicator legend" crop image provided for this timeframe. The number shown there (e.g. "52.96") is the authoritative RSI — use it exactly. State the value, whether overbought (>70) / oversold (<30) / neutral, and any divergence with price. If no crop is provided, read from the chart directly.
• **"dro"**: State: (1) last pivot type — if user-confirmed pivot is provided in "DRO PIVOT DIRECTION" block, use that value directly; otherwise apply the PIVOT DIRECTION RULE: rightmost cycle number BELOW 0 = LOW pivot, ABOVE 0 = HIGH pivot (do NOT use the Mean label for this — it is a separate reference value), (2) direction heading, (3) Mean from the green label, (4) bars since last pivot (rightmost turning point to right edge — NOT numbers between past pivots), (5) cycle progress = bars-since-pivot / Mean as %. Visual line direction is a last resort tiebreaker only, not the primary method.

CONCLUSION FIELD — your "conclusion" MUST:
• Explain HOW indicators across all timeframes work together — connect them into a narrative, don't just list them.
• Explicitly tie EMA structure to DRO cycle: EMA exhaustion + DRO nearing pivot = strong reversal; EMA early trend + DRO mid-cycle = continuation.
• Example: "4H DRO overdue for a HIGH (165% of Mean) while EMA gap is tight (early trend) — conflicting signals reduce confidence. 1H shows wide EMA gap (overextended) + overbought RSI, aligning with bearish DRO direction. 15m DRO also overdue for a LOW. Overall bearish confluence on 1H/15m outweighs 4H ambiguity."

THESIS FEEDBACK REQUIREMENTS — your "thesisFeedback" field MUST:
• Evaluate the user's trend direction for EACH timeframe (4H, 1H, 15m) individually.
• If you DISAGREE with any of their trend assessments, say so explicitly and explain why based on what you see in the chart. Example: "You marked 1H as bullish, but I disagree — RSI 1H is at 72 (overbought) and the last 3 candles show lower highs. The 1H trend looks bearish to me."
• If you AGREE, briefly confirm why. Example: "I agree with your bearish 4H view — the DRO ZigZag is heading down from a HIGH pivot with 60 bars of downside potentially remaining."
• If the user provided no thesis or no trend data, leave this empty.

RESPONSE FORMAT — respond ONLY with valid JSON:
{
  "direction": "HIGHER" | "LOWER" | "UNCLEAR",
  "probability": <number 0-100>,
  "timeframeEstimate": "<e.g. '5-15 minutes'>",
  "analysis": {
    "4h": {
      "ema": "<EMA 50: X, EMA 200: Y, gap: Z% (tight/moderate/wide), crossover state, price position, assessment>",
      "rsi": "<RSI value, overbought/oversold/neutral, divergence if any>",
      "dro": "<last pivot type, direction heading, Mean, bars since pivot, cycle progress %>"
    },
    "1h": {
      "ema": "<same format>",
      "rsi": "<same format>",
      "dro": "<same format>"
    },
    "15m": {
      "ema": "<same format>",
      "rsi": "<same format>",
      "dro": "<same format>"
    }
  },
  "conclusion": "<How all indicators across timeframes work together — the narrative synthesis, 2-4 sentences>",
  "thesisFeedback": "<per-timeframe evaluation following THESIS FEEDBACK REQUIREMENTS above>",
  "keyRisk": "<what could invalidate this, 1-2 sentences>",
  "entry": <number>,
  "stopLoss": <number>,
  "takeProfit": <number>
}

RULES
• probability = how likely a 0.5% move in the predicted direction happens BEFORE 0.5% the other way.
• Be honest — if signals conflict, use UNCLEAR and probability 40-55%.
• Higher timeframe signals (4H) carry more weight than lower ones (15m).
• READ RSI values from the screenshots — divergences on 1H/4H are strong signals for scalp reversals.
• READ DRO values, ZigZag pivots, and the Mean half-cycle label directly from the screenshots. Compare bars-since-last-pivot to the Mean: if near 100% of the Mean from a HIGH → bias up (LOW reversal due); if near 100% from a LOW → bias down (HIGH reversal due). If past half-cycle distances are consistent (close to Mean), the cycle is reliable; if erratic, reduce confidence.
• Stop-loss: 0.4-0.6% from entry — give the trade room to breathe without getting stopped by noise.
• Take-profit: ~0.5-0.7% from entry.
• Example for HIGHER at ETHUSDT ~$2100: entry=2100, stopLoss=2089 (~0.52%), takeProfit=2111 (~0.52%). R:R ≈ 1:1.
• Example for HIGHER at BTCUSDT ~$95000: entry=95000, stopLoss=94525 (~0.5%), takeProfit=95475 (~0.5%).
• Approximate prices: ETHUSDT ~$2,500 · BTCUSDT ~$95,000 · ETHBTC ~0.02650.
• CRITICAL PRECISION: For small-value pairs like ETHBTC, you MUST use 5 decimal places (e.g. 0.02650, not 0.03). A 0.5% move on ETHBTC ~0.02650 is ~0.00013, so levels should differ by at least 0.00013. Example for a SHORT at ETHBTC: entry=0.02650, stopLoss=0.02663, takeProfit=0.02637. NEVER round to fewer than 5 decimals for ETHBTC.`;
  }

  // ─── Parse JSON response ───
  private parseResponse(raw: string, req: AnalysisRequest): AnalysisResponse {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new AnalysisError('Model returned invalid JSON');
    }

    const direction = this.validDirection(json.direction);
    const probability = this.clamp(json.probability, 0, 100);
    const timeframeEstimate =
      typeof json.timeframeEstimate === 'string' ? json.timeframeEstimate : '5-15 minutes';
    const analysis = this.parseAnalysis(json.analysis);
    const conclusion =
      typeof json.conclusion === 'string' && json.conclusion.trim()
        ? json.conclusion.trim()
        : '';

    // Build flat reasoning from structured analysis for backward compat
    const tfParts: string[] = [];
    for (const tf of ['4h', '1h', '15m'] as const) {
      const a = analysis[tf];
      tfParts.push(`[${tf.toUpperCase().replace('M', 'm')}] EMA: ${a.ema}. RSI: ${a.rsi}. DRO: ${a.dro}.`);
    }
    const reasoning = conclusion
      ? `${tfParts.join(' ')} Conclusion: ${conclusion}`
      : tfParts.join(' ');

    const thesisFeedback =
      typeof json.thesisFeedback === 'string' ? json.thesisFeedback.trim() : '';
    const keyRisk = typeof json.keyRisk === 'string' ? json.keyRisk.trim() : '';

    const base = req.symbol === 'BTCUSDT' ? 95000 : req.symbol === 'ETHBTC' ? 0.02650 : 2500;
    let entry = this.price(json.entry, base);
    let stopLoss = this.price(json.stopLoss, direction === 'LOWER' ? entry * 1.005 : entry * 0.995);
    let takeProfit = this.price(json.takeProfit, direction === 'LOWER' ? entry * 0.995 : entry * 1.005);

    // Enforce level separation — both SL and TP should be ~0.4-0.6% from entry
    const minSeparation = entry * 0.003; // at least 0.3%

    if (Math.abs(entry - stopLoss) < minSeparation) {
      stopLoss = direction === 'LOWER'
        ? this.price(entry * 1.005, entry * 1.005)
        : this.price(entry * 0.995, entry * 0.995);
    }
    if (Math.abs(entry - takeProfit) < minSeparation) {
      takeProfit = direction === 'LOWER'
        ? this.price(entry * 0.995, entry * 0.995)
        : this.price(entry * 1.005, entry * 1.005);
    }

    return {
      direction,
      probability,
      timeframeEstimate,
      analysis,
      conclusion,
      reasoning,
      thesisFeedback,
      keyRisk,
      levels: { entry, stopLoss, takeProfit },
      timestamp: new Date().toISOString(),
    };
  }

  private parseAnalysis(val: unknown): Record<Timeframe, TimeframeAnalysis> {
    const fallback: TimeframeAnalysis = { ema: 'N/A', rsi: 'N/A', dro: 'N/A' };
    const result: Record<Timeframe, TimeframeAnalysis> = {
      '4h': { ...fallback },
      '1h': { ...fallback },
      '15m': { ...fallback },
    };

    if (!val || typeof val !== 'object') return result;
    const obj = val as Record<string, unknown>;

    for (const tf of ['4h', '1h', '15m'] as const) {
      const entry = obj[tf];
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      result[tf] = {
        ema: typeof e.ema === 'string' ? e.ema.trim() : 'N/A',
        rsi: typeof e.rsi === 'string' ? e.rsi.trim() : 'N/A',
        dro: typeof e.dro === 'string' ? e.dro.trim() : 'N/A',
      };
    }

    return result;
  }

  private validDirection(v: unknown): Direction {
    const ok: Direction[] = ['HIGHER', 'LOWER', 'UNCLEAR'];
    if (typeof v === 'string' && ok.includes(v as Direction)) return v as Direction;
    return 'UNCLEAR';
  }

  private clamp(v: unknown, min: number, max: number): number {
    if (typeof v !== 'number' || isNaN(v)) return 50;
    return Math.max(min, Math.min(max, Math.round(v)));
  }

  private price(v: unknown, fallback: number): number {
    const val = (typeof v === 'number' && v > 0 && !isNaN(v)) ? v : fallback;
    // Use higher precision for small prices (e.g. ETHBTC ~0.026)
    if (val < 1) return Math.round(val * 1_000_000) / 1_000_000;
    return Math.round(val * 100) / 100;
  }
}

export class AnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisError';
  }
}
