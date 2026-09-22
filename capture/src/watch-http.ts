import type { AnalyzeRequest, AnalyzeResult, CaptureResult } from './watch-tick.js';

async function readError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? fallback;
}

export async function captureFromServer(captureUrl: string, symbol: string): Promise<CaptureResult> {
  const url = `${captureUrl.replace(/\/$/, '')}/capture/polymarket?symbol=${encodeURIComponent(symbol)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(await readError(res, `Capture failed (${res.status})`));
  }
  return (await res.json()) as CaptureResult;
}

export async function analyzeFromWorker(analyzeUrl: string, request: AnalyzeRequest): Promise<AnalyzeResult> {
  const res = await fetch(analyzeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    throw new Error(await readError(res, `Analyze failed (${res.status})`));
  }
  return (await res.json()) as AnalyzeResult;
}
