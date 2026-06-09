interface CdpTarget {
  id: string;
  type: string;
  url?: string;
  title?: string;
  webSocketDebuggerUrl?: string;
}

function cdpBase(cdpUrl: string): string {
  return cdpUrl.replace(/\/$/, '');
}

function isTradingViewChart(url: string | undefined): boolean {
  return url?.includes('tradingview.com/chart') ?? false;
}

async function fetchCdpTargets(cdpBaseUrl: string): Promise<CdpTarget[]> {
  let res: Response;
  try {
    res = await fetch(`${cdpBaseUrl}/json/list`);
  } catch {
    throw new Error(
      `Cannot reach Chrome CDP at ${cdpBaseUrl}. Launch debug Chrome with ./capture/launch-chrome.sh`
    );
  }
  if (!res.ok) {
    throw new Error(
      `Cannot reach Chrome CDP at ${cdpBaseUrl}. Launch debug Chrome with ./capture/launch-chrome.sh`
    );
  }
  return res.json() as Promise<CdpTarget[]>;
}

/** Verify debug Chrome is reachable and has a TradingView chart tab open. */
export async function assertTradingViewTabOpen(cdpUrl: string): Promise<void> {
  const targets = await fetchCdpTargets(cdpBase(cdpUrl));
  const pages = targets.filter((t) => t.type === 'page');

  if (!pages.some((t) => isTradingViewChart(t.url))) {
    throw new Error(
      'No TradingView chart tab found. Open tradingview.com/chart in debug Chrome (./capture/launch-chrome.sh).'
    );
  }
}

export const CDP_CONNECT_TIMEOUT_MS = 30_000;

export const CDP_CONNECT_OPTIONS = {
  timeout: CDP_CONNECT_TIMEOUT_MS,
  /** Skip Playwright default context overrides — required for reliable attach to a live browser. */
  noDefaults: true,
  /** Same machine as the CDP server (enables local optimizations). */
  isLocal: true,
} as const;

export const CDP_CONNECT_HINT =
  'Playwright could not attach to Chrome. Restart debug Chrome with ./capture/launch-chrome.sh and ensure tradingview.com/chart is open.';
