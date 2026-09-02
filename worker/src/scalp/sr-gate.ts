import type {
  ChartExtraction,
  Direction,
  SrGateVerdict,
  SrLevel,
  SrLevelHit,
  SrSnapshot,
  StrategyResult,
  Timeframe,
} from '../types';

/** 0.5% scalp target. */
export const SCALP_TP_PCT = 0.005;
/** Wick buffer so a wall slightly beyond TP still counts as blocking. */
export const WICK_BUFFER_PCT = 0.0015;
/** Both sides this close → chop; no scalp in the middle. */
export const CHOP_ZONE_PCT = 0.0035;
/** Farther from backing than this is a chase; wait for a tap. */
export const PULLBACK_CHASE_PCT = 0.0015;
/** Ignore distant structure on 15m/1H. */
export const ENTRY_TF_HORIZON_PCT = 0.02;
/** 4H only matters as a nearby macro wall. */
export const HTF_HORIZON_PCT = 0.01;
const DUPLICATE_PCT = 0.0005;

const emptySnapshot = (): SrSnapshot => ({
  blocking: null,
  backing: null,
  pathClearToTp: true,
  gate: 'CLEAR',
  triggerPrice: null,
  triggerCondition: null,
  waitAnalysis: null,
});

function roundPct(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function pctLabel(distancePct: number): string {
  return `${(distancePct * 100).toFixed(2)}%`;
}

function distancePct(price: number, level: number): number {
  return Math.abs(level - price) / price;
}

function toHit(price: number, level: SrLevel): SrLevelHit {
  return {
    price: level.price,
    kind: level.kind,
    timeframe: level.timeframe,
    distancePct: roundPct(distancePct(price, level.price)),
    source: level.source,
    strength: level.strength,
  };
}

function horizonForTf(tf: Timeframe): number {
  return tf === '4h' ? HTF_HORIZON_PCT : ENTRY_TF_HORIZON_PCT;
}

function emaKind(ema: number, currentPrice: number): SrLevel['kind'] {
  return ema <= currentPrice ? 'support' : 'resistance';
}

function emaLevel(
  price: number,
  timeframe: Timeframe,
  source: 'ema50' | 'ema200',
  currentPrice: number,
): SrLevel {
  return {
    price,
    kind: emaKind(price, currentPrice),
    source,
    timeframe,
    touches: null,
    strength: source === 'ema200' ? 'strong' : 'medium',
    extractionConfidence: 'high',
  };
}

function isDuplicate(a: SrLevel, b: SrLevel): boolean {
  return distancePct(a.price, b.price) < DUPLICATE_PCT;
}

/** Vision swings plus EMA 50/200 as dynamic S/R (already extracted as numbers). */
export function collectSrLevels(extractions: ChartExtraction[]): SrLevel[] {
  const out: SrLevel[] = [];

  for (const e of extractions) {
    const price = e.currentPrice;
    const candidates: SrLevel[] = [...(e.srLevels ?? [])];

    if (price != null) {
      if (e.ema50 != null) candidates.push(emaLevel(e.ema50, e.timeframe, 'ema50', price));
      if (e.ema200 != null) candidates.push(emaLevel(e.ema200, e.timeframe, 'ema200', price));
    }

    for (const level of candidates) {
      if (!(level.price > 0)) continue;
      const ref = price ?? level.price;
      if (distancePct(ref, level.price) > horizonForTf(level.timeframe)) continue;
      if (out.some((existing) => isDuplicate(existing, level))) continue;
      out.push(level);
    }
  }

  return out;
}

function nearest(
  price: number,
  levels: SrLevel[],
  pred: (level: SrLevel) => boolean,
): SrLevel | null {
  let best: SrLevel | null = null;
  let bestDist = Infinity;
  for (const level of levels) {
    if (!pred(level)) continue;
    const d = distancePct(price, level.price);
    if (d < bestDist) {
      best = level;
      bestDist = d;
    }
  }
  return best;
}

function recheckPullback(kind: SrLevelHit['kind'], price: number): string {
  const label = kind === 'support' ? 'support' : 'resistance';
  return `re-analyze after a tap into ${label} at ${price}`;
}

function recheckRangeBreak(blocking: SrLevelHit, backing: SrLevelHit): string {
  return `re-analyze after price leaves the range (${backing.kind} ${backing.price} – ${blocking.kind} ${blocking.price})`;
}

function buildWaitAnalysis(input: {
  direction: Direction;
  blocking: SrLevelHit | null;
  backing: SrLevelHit | null;
  pathClearToTp: boolean;
  gate: SrGateVerdict;
}): string | null {
  const { direction, blocking, backing, pathClearToTp, gate } = input;
  if (gate === 'CLEAR') return null;

  const side = direction === 'HIGHER' ? 'Long' : 'Short';
  const target = direction === 'HIGHER' ? '+0.5%' : '-0.5%';

  if (gate === 'BLOCKED' && blocking && backing) {
    return `${side} bias, but price is squeezed between ${backing.timeframe} ${backing.kind} at ${backing.price} (${pctLabel(backing.distancePct)} away) and ${blocking.timeframe} ${blocking.kind} at ${blocking.price} (${pctLabel(blocking.distancePct)} away). No clean ${target} scalp run from here — do not trade in the middle of the range.`;
  }

  if (gate === 'BLOCKED' && blocking && !backing) {
    const wall = blocking.kind;
    return `${side} bias, but ${blocking.timeframe} ${wall} at ${blocking.price} (${pctLabel(blocking.distancePct)} away) sits inside the ${target} path with no nearby ${direction === 'HIGHER' ? 'support' : 'resistance'} to anchor entry. Skip this run.`;
  }

  if (gate === 'WAIT_FOR_PULLBACK' && backing && blocking && !pathClearToTp) {
    return `${side} bias, but price is advancing into ${blocking.timeframe} ${blocking.kind} at ${blocking.price} (${pctLabel(blocking.distancePct)} away) — inside the ${target} scalp path. Ideal ${direction === 'HIGHER' ? 'long' : 'short'} entry is nearer ${backing.kind} at ${backing.price}. Do not buy/sell into this wall at market; wait for a pullback to ${backing.kind}, then re-analyze before entering.`;
  }

  if (gate === 'WAIT_FOR_PULLBACK' && backing && pathClearToTp) {
    return `${side} bias with a clear ${target} path, but price is ${pctLabel(backing.distancePct)} away from ideal ${backing.kind} at ${backing.price}. Wait for a tap into that level before entering — do not chase.`;
  }

  if (gate === 'WAIT_FOR_BREAK' && blocking) {
    return `${side} bias, but structure must resolve first. Do not enter on a break-through — re-analyze only after the range clears.`;
  }

  return null;
}

export function evaluateSrGate(input: {
  currentPrice: number | null;
  direction: Direction;
  extractions: ChartExtraction[];
}): SrSnapshot {
  const { currentPrice, direction } = input;
  if (currentPrice == null || currentPrice <= 0 || direction === 'UNCLEAR') {
    return emptySnapshot();
  }

  const levels = collectSrLevels(input.extractions);
  const blockingLevel =
    direction === 'HIGHER'
      ? nearest(currentPrice, levels, (l) => l.kind === 'resistance' && l.price > currentPrice)
      : nearest(currentPrice, levels, (l) => l.kind === 'support' && l.price < currentPrice);
  const backingLevel =
    direction === 'HIGHER'
      ? nearest(currentPrice, levels, (l) => l.kind === 'support' && l.price < currentPrice)
      : nearest(currentPrice, levels, (l) => l.kind === 'resistance' && l.price > currentPrice);

  const blocking = blockingLevel ? toHit(currentPrice, blockingLevel) : null;
  const backing = backingLevel ? toHit(currentPrice, backingLevel) : null;
  const pathClearToTp = !(blocking != null && blocking.distancePct < SCALP_TP_PCT + WICK_BUFFER_PCT);

  let gate: SrGateVerdict = 'CLEAR';
  let triggerPrice: number | null = null;
  let triggerCondition: string | null = null;

  const inChop =
    blocking != null &&
    backing != null &&
    blocking.distancePct < CHOP_ZONE_PCT &&
    backing.distancePct < CHOP_ZONE_PCT;

  if (inChop) {
    gate = 'BLOCKED';
    triggerPrice = blocking.price;
    triggerCondition = recheckRangeBreak(blocking, backing);
  } else if (!pathClearToTp && blocking) {
    if (backing) {
      gate = 'WAIT_FOR_PULLBACK';
      triggerPrice = backing.price;
      triggerCondition = recheckPullback(backing.kind, backing.price);
    } else {
      gate = 'BLOCKED';
      triggerPrice = blocking.price;
      triggerCondition = `re-analyze if structure changes at ${blocking.kind} ${blocking.price}`;
    }
  } else if (backing != null && backing.distancePct > PULLBACK_CHASE_PCT) {
    gate = 'WAIT_FOR_PULLBACK';
    triggerPrice = backing.price;
    triggerCondition = recheckPullback(backing.kind, backing.price);
  }

  const waitAnalysis = buildWaitAnalysis({ direction, blocking, backing, pathClearToTp, gate });

  return { blocking, backing, pathClearToTp, gate, triggerPrice, triggerCondition, waitAnalysis };
}

function minSep(entry: number): number {
  return entry * SCALP_TP_PCT;
}

function snapPullbackLevels(result: StrategyResult, snapshot: SrSnapshot, direction: Direction): StrategyResult {
  if (snapshot.gate !== 'WAIT_FOR_PULLBACK' || snapshot.backing == null || direction === 'UNCLEAR') {
    return result;
  }

  const entry = snapshot.backing.price;
  const sep = minSep(entry);
  const stopLoss = direction === 'HIGHER' ? entry - sep : entry + sep;
  const takeProfit = direction === 'HIGHER' ? entry + sep : entry - sep;
  const slDist = Math.abs(stopLoss - entry);
  const tpDist = Math.abs(takeProfit - entry);

  return {
    ...result,
    entry,
    stopLoss,
    takeProfit,
    riskReward: slDist > 0 ? parseFloat((tpDist / slDist).toFixed(2)) : result.riskReward,
  };
}

/**
 * Code-side enforcement so the strategy model cannot TAKE through a nearby wall.
 * Never upgrades SKIP → TAKE/WAIT. Snaps entry to backing on WAIT_FOR_PULLBACK.
 */
export function applySrGate(
  result: StrategyResult,
  snapshot: SrSnapshot,
  direction: Direction,
): StrategyResult {
  const withLevels = snapPullbackLevels(result, snapshot, direction);

  if (snapshot.gate === 'CLEAR' || !snapshot.waitAnalysis) return withLevels;

  const reason = snapshot.waitAnalysis;
  const recheck = snapshot.triggerCondition ? ` Re-check: ${snapshot.triggerCondition}.` : '';

  if (result.tradeRecommendation === 'SKIP' || snapshot.gate === 'BLOCKED') {
    return {
      ...withLevels,
      tradeRecommendation: 'SKIP',
      recommendationReasoning: [reason + recheck, withLevels.recommendationReasoning].filter(Boolean).join(' '),
    };
  }

  return {
    ...withLevels,
    tradeRecommendation: 'WAIT',
    recommendationReasoning: [reason + recheck, withLevels.recommendationReasoning].filter(Boolean).join(' '),
  };
}
