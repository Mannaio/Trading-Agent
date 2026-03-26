import type { AnalysisRequest, Symbol, TrendDirection, Timeframe, ScreenshotMeta } from './types';

const VALID_SYMBOLS: Symbol[] = ['ETHUSDT', 'BTCUSDT', 'ETHBTC'];
const VALID_TRENDS: TrendDirection[] = ['bullish', 'bearish', 'neutral'];
const VALID_TIMEFRAMES: Timeframe[] = ['4h', '1h', '15m'];
const TIMEFRAMES = ['4h', '1h', '15m'] as const;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validate the raw request body and return a typed AnalysisRequest.
 */
export function validateRequest(body: unknown): AnalysisRequest {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Request body must be a JSON object');
  }

  const b = body as Record<string, unknown>;

  // ── symbol ──
  if (typeof b.symbol !== 'string' || !VALID_SYMBOLS.includes(b.symbol as Symbol)) {
    throw new ValidationError(`symbol must be one of: ${VALID_SYMBOLS.join(', ')}`);
  }
  const symbol = b.symbol as Symbol;

  // ── screenshots (max 3) ──
  if (!Array.isArray(b.screenshots)) {
    throw new ValidationError('screenshots must be an array');
  }
  if (b.screenshots.length > 3) {
    throw new ValidationError('Maximum 3 screenshots allowed');
  }
  for (const s of b.screenshots) {
    if (typeof s !== 'string' || !s.startsWith('data:image/')) {
      throw new ValidationError('Each screenshot must be a base64 data URL');
    }
  }
  const screenshots = b.screenshots as string[];

  // ── userReasoning ──
  if (typeof b.userReasoning !== 'string') {
    throw new ValidationError('userReasoning must be a string');
  }
  const userReasoning = b.userReasoning;

  if (screenshots.length === 0 && userReasoning.trim().length === 0) {
    throw new ValidationError('Provide at least one screenshot or your reasoning');
  }

  // ── screenshotsMeta (optional) ──
  let screenshotsMeta: ScreenshotMeta[] | undefined;
  if (b.screenshotsMeta !== undefined && b.screenshotsMeta !== null) {
    if (!Array.isArray(b.screenshotsMeta)) {
      throw new ValidationError('screenshotsMeta must be an array');
    }
    screenshotsMeta = (b.screenshotsMeta as unknown[]).map((item, i) => {
      if (!item || typeof item !== 'object') {
        throw new ValidationError(`screenshotsMeta[${i}] must be an object`);
      }
      const m = item as Record<string, unknown>;
      if (typeof m.dataUrl !== 'string' || !m.dataUrl.startsWith('data:image/')) {
        throw new ValidationError(`screenshotsMeta[${i}].dataUrl must be a base64 data URL`);
      }
      if (typeof m.timeframe !== 'string' || !VALID_TIMEFRAMES.includes(m.timeframe as Timeframe)) {
        throw new ValidationError(`screenshotsMeta[${i}].timeframe must be 4h, 1h, or 15m`);
      }
      const meta: ScreenshotMeta = {
        dataUrl: m.dataUrl as string,
        timeframe: m.timeframe as Timeframe,
      };
      if (m.ema50 !== undefined && m.ema50 !== null) {
        if (typeof m.ema50 !== 'number' || isNaN(m.ema50) || m.ema50 <= 0) {
          throw new ValidationError(`screenshotsMeta[${i}].ema50 must be a positive number`);
        }
        meta.ema50 = m.ema50;
      }
      if (m.ema200 !== undefined && m.ema200 !== null) {
        if (typeof m.ema200 !== 'number' || isNaN(m.ema200) || m.ema200 <= 0) {
          throw new ValidationError(`screenshotsMeta[${i}].ema200 must be a positive number`);
        }
        meta.ema200 = m.ema200;
      }
      return meta;
    });
  }

  // ── indicators (optional) ──
  let indicators: AnalysisRequest['indicators'];
  if (b.indicators !== undefined && b.indicators !== null) {
    indicators = validateIndicators(b.indicators);
  }

  // ── pastLessons (optional) ──
  let pastLessons: string[] | undefined;
  if (b.pastLessons !== undefined && b.pastLessons !== null) {
    if (!Array.isArray(b.pastLessons)) {
      throw new ValidationError('pastLessons must be an array');
    }
    pastLessons = (b.pastLessons as unknown[])
      .filter((l): l is string => typeof l === 'string' && l.trim().length > 0)
      .slice(0, 10); // cap at 10 lessons
  }

  return { symbol, screenshots, screenshotsMeta, userReasoning, indicators, pastLessons };
}

function validateIndicators(val: unknown): NonNullable<AnalysisRequest['indicators']> {
  if (!val || typeof val !== 'object') {
    throw new ValidationError('indicators must be an object');
  }
  const ind = val as Record<string, unknown>;

  // Trend direction
  if (!ind.trend || typeof ind.trend !== 'object') {
    throw new ValidationError('indicators.trend must be an object');
  }
  const rawTrend = ind.trend as Record<string, unknown>;
  for (const tf of TIMEFRAMES) {
    if (typeof rawTrend[tf] !== 'string' || !VALID_TRENDS.includes(rawTrend[tf] as TrendDirection)) {
      throw new ValidationError(`indicators.trend.${tf} must be bullish or bearish`);
    }
  }
  const trend = {
    '4h': rawTrend['4h'] as TrendDirection,
    '1h': rawTrend['1h'] as TrendDirection,
    '15m': rawTrend['15m'] as TrendDirection,
  };

  return { trend };
}
