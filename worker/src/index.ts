import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { validateRequest, ValidationError } from './validate';
import { AnalysisAgent, AnalysisError } from './agents/analysis';

const app = new Hono<{ Bindings: Env }>();

// CORS
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}));

// Health-check
app.get('/api/health', (c) =>
  c.json({ status: 'ok', timestamp: new Date().toISOString() }),
);

// ─── Main prediction endpoint ───
app.post('/api/analyze', async (c) => {
  try {
    const apiKey = c.env.OPENAI_API_KEY;
    if (!apiKey) {
      return c.json({ error: 'Missing OPENAI_API_KEY' }, { status: 500 });
    }

    // Parse JSON body
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    // Validate
    const request = validateRequest(body);

    // Analyze (GPT-4o vision)
    const agent = new AnalysisAgent(apiKey);
    const result = await agent.analyze(request);

    return c.json(result);
  } catch (err) {
    console.error('Analyze error:', err);

    if (err instanceof ValidationError) {
      return c.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof AnalysisError) {
      return c.json({ error: `Analysis failed: ${err.message}` }, { status: 502 });
    }
    if (err instanceof Error && (err.message.includes('API') || err.message.includes('401'))) {
      return c.json({ error: 'AI service error — check API key' }, { status: 503 });
    }
    return c.json({ error: 'Unexpected error' }, { status: 500 });
  }
});

// 404
app.notFound((c) => c.json({ error: 'Not found' }, { status: 404 }));

export default app;
