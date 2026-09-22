import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDotEnv, loadWatchConfig } from './watch-config.js';
import { analyzeFromWorker, captureFromServer } from './watch-http.js';
import { createMailer } from './watch-mail.js';
import { createOverlapGuard, runTick, type TickDeps } from './watch-tick.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

async function main(): Promise<void> {
  applyDotEnv(join(rootDir, '.env'));
  const config = loadWatchConfig(process.env);
  const once = process.argv.includes('--once');
  const log = (msg: string) => {
    console.log(`[watch] ${new Date().toISOString()} ${msg}`);
  };

  const deps: TickDeps = {
    capture: (symbol) => captureFromServer(config.captureUrl, symbol),
    analyze: (request) => analyzeFromWorker(config.analyzeUrl, request),
    sendEmail: createMailer(config.smtp),
    log,
  };

  const tick = async () => {
    log(`tick ${config.symbol} ${config.marketWindow} minConfidence=${config.minConfidence}`);
    await runTick(
      {
        symbol: config.symbol,
        marketWindow: config.marketWindow,
        minConfidence: config.minConfidence,
      },
      deps,
    );
  };

  if (once) {
    await tick();
    return;
  }

  log(`loop every ${config.intervalMs}ms — Ctrl+C to stop`);
  const guarded = createOverlapGuard(tick, log);
  await guarded();
  setInterval(() => {
    void guarded();
  }, config.intervalMs);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[watch] ${message}`);
  process.exit(1);
});
