export const config = { runtime: 'edge' };

const OPENCODE_API_KEYS = [
  'sk-s1drxz7SI85JoRGVHzYeyLwY0iTuwSwDT7r4hpeyN5iDos0hlhaMhSZIYKC5tk8b',
  'sk-Kp21c95wzZS5ocyQwmq0ITxdgYB5OATJ5FI7V1fYNCk3y5PluH1zv9EmDyXv9wCm',
  'sk-nitMD6TV0O9C4pNWCCfWVbY8Bx0pc2en95FmAXQ8ra9HHnfzdXZQpWzVZtVj6RLk',
  'sk-dNoFYbd44tSkdKXO2Ti7suPbdwvGbp1wibP97x4G6oP8JpU1mbSEjWgHcLQ7B87p',
  'sk-TfhQc966OFJj5myCAGIa9vzVizWmCGDUsA3rWEJXbEV8AxALvs1sbCinWRwTGwM6',
  'sk-RGmm7MZ2ooXy8usYF6jz2rVNhpdEEQA4DKchksDQCB35EofEpOd6KGl7lnTwETel',
  'sk-cJQ6Np5mnjahzvXTIswoz5injEBhx6rRKotk4Nlr4haELWpWh15KTBtULT2DFhJy',
  'sk-7So4xL8vdgeiGLHVDbSzalyaoglNIMDB6iR75wzitZW6dunptyaYj6fRpwoZ8a3w',
  'sk-PtftPt3wJHldnFgDG0hMSTguJN4KXFBxjewvEG51ivACIow3sD3dIx4hWcCony6N',
  'sk-3YPPMLHREJXlfV1UcwtU8kVnrqZEruRESjg0JLbuZhutMmKnOuTxCwL0BzRlpYCF',
];

let _keyIndex = 0;
function getNextKey() {
  const key = OPENCODE_API_KEYS[_keyIndex % OPENCODE_API_KEYS.length];
  _keyIndex = (_keyIndex + 1) % OPENCODE_API_KEYS.length;
  return key;
}

const SSE = {
  encode: (obj) => `data: ${JSON.stringify(obj)}\n\n`,
  done: () => 'data: [DONE]\n\n',
};

const SYSTEM_PROMPT = `You are Void V1 Flash, created by vin. Answer concisely.`;

const LEAK_PATTERNS = [
  /\bDeepSeek\b/i,
  /\bdeep\s*seek\b/i,
  /\bMixture\s+of\s+Experts\b/i,
  /\bMoE\b/i,
  /\b\d+\s*(?:billion|trillion)\s*(?:parameter|param)\b/i,
  /\bOpenRouter\b/i,
  /\bopencode\b/i,
  /\bcontext\s+(?:window|length|size)\s*(?::|is|of)?\s*\d+/i,
  /\btraining\s+cutoff\b/i,
  /\bknowledge\s+cutoff\b/i,
  /\bOpenAI\b/i,
  /\bChatGPT\b/i,
  /\bGPT[-\s]?\d\b/i,
  /\bClaude\b/i,
  /\bLlama\b/i,
];

function filterReasoning(text) {
  if (!text || typeof text !== 'string') return text;
  let result = text;
  for (const re of LEAK_PATTERNS) {
    result = result.replace(re, '');
  }
  return result;
}

const ROTATE_STATUS = new Set([401, 403, 429, 500, 502, 503]);

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }); }

  const { messages, stream = false, model, temperature = 0.7, max_tokens = 2048, reasoning_effort } = body;

  const hasReasoning = reasoning_effort != null && reasoning_effort !== false && reasoning_effort !== 0;

  const upstreamBody = {
    model: model || 'deepseek-v4-flash-free',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(messages || []).filter(m => m.role !== 'system'),
    ],
    temperature,
    max_tokens: Math.max(2048, max_tokens),
    stream,
  };

  if (hasReasoning) {
    upstreamBody.reasoning = { effort: reasoning_effort === 'high' ? 'high' : 'low' };
  }

  let upstreamRes;
  let lastErr;
  let lastStatus = 503;

  for (let attempt = 0; attempt < OPENCODE_API_KEYS.length; attempt++) {
    const key = getNextKey();
    try {
      upstreamRes = await fetch('https://opencode.ai/zen/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(upstreamBody),
      });
      if (upstreamRes.ok) break;
      lastStatus = upstreamRes.status;
      if (!ROTATE_STATUS.has(lastStatus)) break;
    } catch (e) { lastErr = e; lastStatus = 503; }
  }

  if (!upstreamRes || !upstreamRes.ok) {
    return new Response(JSON.stringify({ error: 'Upstream error', status: upstreamRes?.status || lastStatus }), { status: 502 });
  }

  if (!stream) {
    const data = await upstreamRes.json();
    const choice = data?.choices?.[0];
    let content = choice?.message?.content ?? '';
    const reasoningContent = choice?.message?.reasoning_content ?? null;

    if (!hasReasoning) {
      content = content.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
    }

    const resBody = {
      id: data?.id || `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: data?.created || Math.floor(Date.now() / 1000),
      model: data?.model || model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: choice?.finish_reason || 'stop',
      }],
      usage: data?.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };

    if (hasReasoning && reasoningContent) {
      resBody.choices[0].message.reasoning_content = filterReasoning(reasoningContent);
    }

    return new Response(JSON.stringify(resBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // Streaming
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const readable = new ReadableStream({
    async start(controller) {
      const reader = upstreamRes.body.getReader();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue;
            if (!trimmed.startsWith('data:')) continue;

            const raw = trimmed.slice(5).trim();
            if (raw === '[DONE]') {
              controller.enqueue(encoder.encode(SSE.done()));
              continue;
            }

            let parsed;
            try { parsed = JSON.parse(raw); } catch { continue; }

            const choice = parsed?.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta || {};
            const outDelta = {};

            if (delta.content != null) {
              let c = delta.content;
              if (!hasReasoning) {
                c = c.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
              }
              if (c) outDelta.content = c;
            }

            if (hasReasoning && delta.reasoning_content != null) {
              const filtered = filterReasoning(delta.reasoning_content);
              if (filtered) outDelta.reasoning_content = filtered;
            }

            if (Object.keys(outDelta).length > 0 || choice.finish_reason) {
              controller.enqueue(encoder.encode(SSE.encode({
                id: parsed.id || `chatcmpl-${Date.now()}`,
                object: 'chat.completion.chunk',
                created: parsed.created || Math.floor(Date.now() / 1000),
                model: parsed.model || model,
                choices: [{
                  index: 0,
                  delta: outDelta,
                  finish_reason: choice.finish_reason || null,
                }],
              })));
            }
          }
        }
      } catch (e) {
      } finally {
        controller.enqueue(encoder.encode(SSE.done()));
        try { controller.close(); } catch (_) {}
      }
    },
  });

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
