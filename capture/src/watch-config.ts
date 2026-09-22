import { existsSync, readFileSync } from 'node:fs';
import { DEFAULT_MIN_CONFIDENCE, type PolymarketMarketWindow } from './watch-notify.js';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  to: string;
}

export interface WatchConfig {
  symbol: string;
  marketWindow: PolymarketMarketWindow;
  captureUrl: string;
  analyzeUrl: string;
  intervalMs: number;
  minConfidence: number;
  smtp: SmtpConfig;
}

export function applyDotEnv(filePath: string, env: Record<string, string | undefined> = process.env): void {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (env[key] == null || env[key] === '') {
      env[key] = value;
    }
  }
}

function required(env: Record<string, string | undefined>, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`Missing ${key}`);
  }
  return value;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error('SMTP_PORT must be a positive integer');
  }
  return n;
}

function parseIntervalMs(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1000) {
    throw new Error('INTERVAL_MS must be at least 1000');
  }
  return n;
}

function parseMinConfidence(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new Error('MIN_CONFIDENCE must be between 0 and 100');
  }
  return n;
}

export function loadWatchConfig(env: Record<string, string | undefined>): WatchConfig {
  const to = required(env, 'ALERT_TO');
  const user = required(env, 'SMTP_USER');
  const pass = required(env, 'SMTP_PASS');

  const marketWindow = env.MARKET_WINDOW?.trim() || '5m';
  if (marketWindow !== '5m' && marketWindow !== '15m') {
    throw new Error('MARKET_WINDOW must be 5m or 15m');
  }

  return {
    symbol: env.SYMBOL?.trim() || 'ETHUSDT',
    marketWindow,
    captureUrl: env.CAPTURE_URL?.trim() || 'http://localhost:3001',
    analyzeUrl: env.ANALYZE_URL?.trim() || 'http://localhost:8787/api/polymarket/analyze',
    intervalMs: parseIntervalMs(env.INTERVAL_MS, 15 * 60 * 1000),
    minConfidence: parseMinConfidence(env.MIN_CONFIDENCE, DEFAULT_MIN_CONFIDENCE),
    smtp: {
      host: env.SMTP_HOST?.trim() || 'smtp.gmail.com',
      port: parsePort(env.SMTP_PORT, 465),
      user,
      pass,
      to,
    },
  };
}
