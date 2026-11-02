/**
 * Phase B.1 local mock OpenAI provider.
 *
 * Loopback only. Never contacts the real OpenAI API. Behaviour is keyed by the
 * synthetic bearer token so the isolation suite can exercise success, auth
 * failure, empty output and provider failure without real credentials.
 */

import http from 'node:http';

const PORT = Number(process.env.MOCK_OPENAI_PORT ?? 3199);
let lastRequest = null;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true });
  }
  if (req.method === 'GET' && req.url === '/last') {
    return send(res, 200, { last: lastRequest });
  }
  if (req.method === 'POST' && req.url === '/reset') {
    lastRequest = null;
    return send(res, 200, { ok: true });
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    return send(res, 404, { error: 'not found' });
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { error: 'invalid json' });
  }

  const authorization = req.headers.authorization ?? '';
  const key = authorization.replace(/^Bearer\s+/i, '').trim();
  const userMessage = Array.isArray(body?.messages)
    ? body.messages.find((m) => m?.role === 'user')?.content ?? ''
    : '';
  lastRequest = {
    authorization,
    model: body?.model ?? '',
    system: body?.messages?.find((m) => m?.role === 'system')?.content ?? '',
    user: userMessage,
  };

  if (key === 'invalid-key') {
    return send(res, 401, { error: { message: 'synthetic invalid key', type: 'invalid_request_error' } });
  }
  if (key === 'fail-key') {
    return send(res, 500, { error: { message: 'synthetic provider failure', type: 'server_error' } });
  }
  if (key === 'empty-key') {
    return send(res, 200, {
      choices: [{ message: { content: '' } }],
      usage: { prompt_tokens: 4, completion_tokens: 0, total_tokens: 4 },
    });
  }

  const businessName = /Business name \(reference only, never invent details\):\s*\n([^\n]+)/.exec(userMessage)?.[1]?.trim();
  const text = businessName
    ? `Mock HTTP OpenAI draft for ${businessName} based on the customer words.`
    : 'Mock HTTP OpenAI draft based on the customer words.';

  return send(res, 200, {
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 21, completion_tokens: 13, total_tokens: 34 },
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-openai] listening on 127.0.0.1:${PORT}`);
});
