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
