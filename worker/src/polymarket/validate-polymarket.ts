import type { PolymarketMarketWindow, PolymarketRequest, PolymarketSymbol } from './types';

const VALID_WINDOWS: PolymarketMarketWindow[] = ['5m', '15m'];
const VALID_SYMBOLS: PolymarketSymbol[] = ['ETHUSDT', 'BTCUSD', 'BNBUSDT'];

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

  if (typeof b.symbol !== 'string' || !VALID_SYMBOLS.includes(b.symbol as PolymarketSymbol)) {
    throw new PolymarketValidationError(`symbol must be one of: ${VALID_SYMBOLS.join(', ')}`);
  }
  const symbol = b.symbol as PolymarketSymbol;

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
    symbol,
    screenshot: b.screenshot,
    marketWindow: b.marketWindow,
    ...(screenshotsMeta && { screenshotsMeta }),
    ...(marketPrices && { marketPrices }),
    ...(notes && { notes }),
  };
}
