import OpenAI from 'openai';
import type { AnalysisRequest, AnalysisResponse, Direction } from '../types';

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
      max_tokens: 2048,
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

    // Screenshots (vision)
    for (const dataUrl of req.screenshots) {
      userContent.push({
        type: 'image_url',
        image_url: { url: dataUrl, detail: 'high' },
      });
    }

    // Text portion
    let text = `Symbol: ${req.symbol}\n`;

    if (req.userReasoning.trim()) {
      text += `\nMY REASONING / THESIS:\n${req.userReasoning.trim()}\n`;
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

  // ─── System prompt ───
  private systemPrompt(): string {
    return `You are an expert cryptocurrency scalp-trading analyst.

GOAL
Predict whether price will move UP or DOWN by at least 0.5% from the current level in the near term (minutes to ~30 min). This is a scalp trade.

INPUTS YOU RECEIVE
• Up to 3 chart screenshots (typically 4H, 1H, 15m) — these show candlestick charts with overlaid indicators. The standard setup includes:
  - DRO Alert / ZigZag (bottom panel) — shows cycle pivots (HIGH/LOW labels), dominant cycle length, and distances between pivots. This is the PRIMARY trend/cycle indicator.
  - RSI (Relative Strength Index) — above 70 = overbought, below 30 = oversold. Look for divergences with price.
  - DRO Oscillator (Detrended Rhythm Oscillator) — shows momentum and cycle timing. Zero-line crossings and divergences are key.
  - EMA / price action / support & resistance — visible on the main chart.
  However, the user may sometimes upload charts with DIFFERENT indicators (e.g. MACD, Bollinger Bands, Stochastic, etc.). You must adapt — identify whatever indicators are visible and analyze them using the same structured approach.
• The user's own reasoning or thesis (may be empty)
• Optional structured data the user provides:
  - Trend direction per timeframe (4H, 1H, 15m) as assessed by the user
    · This is their subjective view based on whatever method they use (EMA, market structure, price action)
    · You may agree or disagree based on what you see in the charts

YOUR JOB — follow this EXACT analysis order:
1. **DRO Cycle (trend direction):** Start with the DRO Alert ZigZag. Follow these sub-steps CAREFULLY:
   a) **Identify the LAST completed pivot.** The ZigZag alternates HIGH→LOW→HIGH→LOW. Trace the line from left to right and find the LAST turning point — is it a HIGH (line turned downward) or a LOW (line turned upward)?
   b) **Determine current direction.** If the last pivot was a HIGH → ZigZag is heading DOWN. If the last pivot was a LOW → ZigZag is heading UP. This sets your PRIMARY directional bias.
   c) **Read the "Mean" label** (right side of the DRO panel). This is the average half-cycle length in bars — ALWAYS use this as your reference cycle length.
   d) **Count bars since last pivot.** This is how many bars have passed from the last turning point to the current bar. CRITICAL: Do NOT confuse this with the numbers printed between past pivots — those are distances of COMPLETED past half-cycles and are NOT the current bar count. The current bar count is the distance from the rightmost pivot to the right edge of the chart.
   e) **Calculate cycle progress:** bars-since-last-pivot / Mean × 100%. Example: if last pivot was a LOW 35 bars ago and Mean is 68, you are 51% through the upward half-cycle.
   f) If DRO Alert is not visible, determine the trend from whatever trend/cycle indicator IS visible, or from price structure.
2. **RSI Validation:** Read the RSI value from each timeframe. Does RSI confirm or challenge the DRO trend? Look for overbought/oversold levels and divergences with price. If RSI is not visible, use whatever momentum indicator IS visible to validate the trend.
3. **DRO Momentum (timing):** Read the DRO Oscillator value. Is it above/below zero? Crossing? Diverging from price? This tells you if momentum supports the cycle direction or is weakening. If the DRO Oscillator is not visible, use whatever oscillator IS visible for timing.
4. **Combine:** Only after completing steps 1→2→3, synthesize into a directional prediction with probability.
5. **User thesis:** Consider the user's reasoning — agree or disagree honestly.
6. **Past lessons:** If provided, check if the current setup resembles any past losing trade. Flag it and adjust confidence accordingly.
7. **Trade levels:** Provide entry, stop-loss, take-profit.

IMPORTANT: If the screenshots show DIFFERENT indicators than DRO/RSI (e.g. MACD, Bollinger Bands, Stochastic, etc.), adapt your analysis. Follow the same structure — trend first, then validation, then timing — but use whatever indicators are actually visible. Name them explicitly in your reasoning.

REASONING REQUIREMENTS — your "reasoning" field MUST follow this structure:
• **DRO Cycle:** You MUST state ALL of the following: (1) the last pivot type — HIGH or LOW, (2) that the ZigZag is therefore heading in the OPPOSITE direction (DOWN from HIGH, UP from LOW), (3) the Mean half-cycle length, (4) bars since last pivot (counted from the rightmost pivot to the current bar — NOT a number from between past pivots), (5) cycle progress = bars-since-pivot / Mean as a percentage. Example: "Last pivot was a LOW ~35 bars ago. Mean is 68 → 51% through the upward half-cycle, suggesting more room for upside before a HIGH forms." NEVER confuse past half-cycle distances (numbers printed between pivots) with bars-since-last-pivot. If DRO is not visible, describe the trend from the available indicators instead.
• **RSI Validation:** State the RSI value for each timeframe (e.g. "RSI 4H at 72, 1H at 45, 15m at 62") and whether it confirms or diverges from the DRO trend. If RSI is not visible, validate using whatever momentum indicator is shown.
• **DRO Momentum:** State the DRO Oscillator value, direction, and any zero-line crossings or divergences. If not visible, use whatever oscillator is available.
• **Conclusion:** Explain HOW these indicators work together — connect them into a narrative, don't just list them. Example: "DRO ZigZag printed a HIGH pivot 6 bars ago on the 4H and is heading down. RSI 4H at 72 is overbought, confirming downside pressure. DRO Oscillator is below zero and declining, meaning bearish momentum is accelerating. However, 15m RSI at 32 suggests a short-term bounce before the larger move down."
• If DRO ZigZag cycle data is visible, always reference cycle progress as bars-since-pivot / Mean. Read the Mean value and pivot labels directly from the chart images.

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
  "reasoning": "<detailed analysis following REASONING REQUIREMENTS above, 4-8 sentences>",
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
    const reasoning =
      typeof json.reasoning === 'string' && json.reasoning.trim()
        ? json.reasoning.trim()
        : 'No reasoning provided.';
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
      reasoning,
      thesisFeedback,
      keyRisk,
      levels: { entry, stopLoss, takeProfit },
      timestamp: new Date().toISOString(),
    };
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
