import OpenAI from 'openai';

const RETRY_DELAY_MS = 600;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class VisionJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VisionJsonError';
  }
}

export function isVisionRefusal(err: unknown): boolean {
  return err instanceof VisionJsonError && err.message.includes('refusal=');
}

/**
 * Calls a vision/chat completion expecting JSON content, with retries on empty responses.
 */
export async function callVisionJson(
  client: OpenAI,
  agentName: string,
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  retries = 2,
): Promise<string> {
  let lastFinish = 'unknown';
  let lastRefusal: string | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const completion = await client.chat.completions.create(params);
    const choice = completion.choices[0];
    const raw = choice?.message?.content;

    if (raw) return raw;

    lastFinish = choice?.finish_reason ?? 'unknown';
    lastRefusal = choice?.message?.refusal ?? null;

    if (lastRefusal) {
      break;
    }

    if (attempt < retries) {
      console.warn(
        `[${agentName}] Empty model response (finish=${lastFinish}), retry ${attempt + 1}/${retries}`,
      );
      await sleep(RETRY_DELAY_MS * (attempt + 1));
      continue;
    }
  }

  const refusalNote = lastRefusal ? `, refusal=${lastRefusal}` : '';
  throw new VisionJsonError(
    `Empty response from model (agent=${agentName}, finish=${lastFinish}${refusalNote})`,
  );
}
