/**
 * Minimal OpenAI chat-completions client.
 *
 * Consumes the per-tenant key/value already stored via the tenant settings
 * flow (src/app/api/settings/route.ts → TenantSettings.openai, AES-encrypted
 * with src/lib/crypto.ts). No new API-key storage is introduced here.
 */

export interface ChatCompletionInput {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}

export interface ChatCompletionResult {
  text: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

/**
 * Single-turn chat completion against the public OpenAI API.
 * Throws on transport, API or status errors.
 */
export async function chatCompletion(input: ChatCompletionInput): Promise<ChatCompletionResult> {
  const { apiKey, model, system, user, maxTokens = 600 } = input;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    // Client-side deadline, deliberately shorter than the route's `maxDuration`
    // (60s) so a stalled upstream produces a caught error and a clean 503 rather
    // than a platform-level function kill that never reaches our logs. Also
    // shorter than a typical chat completion, so timeouts mean "upstream is
    // genuinely stuck", not "we cut it off early".
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenAI request failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };

  const text = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!text) throw new Error('OpenAI returned an empty response');

  return {
    text,
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      totalTokens: data.usage?.total_tokens ?? 0,
    },
  };
}