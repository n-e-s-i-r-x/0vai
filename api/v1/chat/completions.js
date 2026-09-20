export const config = { runtime: 'edge' };

const UPSTREAM = 'https://api.kilo.ai/api/gateway/chat/completions';
const MODEL = 'kilo-auto/free';
const PUBLIC_MODEL = 'Void V1 Flash';
const IDENTITY = 'You are Void V1 Flash, created by 0vai and powered by Void.';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, api-key, x-api-key',
};

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { ...CORS, 'Content-Type': 'application/json' },
});
const error = (message, code, status = 400) => json({ error: { message, type: status >= 500 ? 'server_error' : 'invalid_request_error', code } }, status);
const now = () => Math.floor(Date.now() / 1000);
const completionId = id => typeof id === 'string' && id ? id.replace(/[^a-zA-Z0-9_.-]/g, '') : `chatcmpl-${Date.now()}`;

function removePrivateThought(text) {
  return String(text || '')
    .replace(/<think(?:ing)?(?:\s[^>]*)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    .replace(/<think(?:ing)?\s*\/?>/gi, '')
    .replace(/<\|\|DSML\|\|[\s\S]*?<\/\|\|DSML\|\|>/gi, '')
    .trim();
}

class ThoughtFilter {
  constructor() { this.pending = ''; this.inside = false; }
  push(value) {
    this.pending += value;
    let output = '';
    while (this.pending) {
      if (this.inside) {
        const end = this.pending.search(/<\/think(?:ing)?>/i);
        if (end < 0) { this.pending = this.pending.slice(-12); break; }
        const close = this.pending.match(/<\/think(?:ing)?>/i)[0];
        this.pending = this.pending.slice(end + close.length);
        this.inside = false;
      } else {
        const match = this.pending.match(/<think(?:ing)?(?:\s[^>]*)?>/i);
        if (!match) {
          const safe = Math.max(0, this.pending.length - 12);
          output += this.pending.slice(0, safe);
          this.pending = this.pending.slice(safe);
          break;
        }
        output += this.pending.slice(0, match.index);
        this.pending = this.pending.slice(match.index + match[0].length);
        this.inside = true;
      }
    }
    return output;
  }
  finish() { const result = this.inside ? '' : this.pending; this.pending = ''; this.inside = false; return result; }
}

function sse(payload) { return `data: ${JSON.stringify(payload)}\n\n`; }
function chunk(id, created, delta, finish_reason = null) {
  return { id, object: 'chat.completion.chunk', created, model: PUBLIC_MODEL, choices: [{ index: 0, delta, finish_reason }] };
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return error('Only POST is supported.', 'method_not_allowed', 405);

  let input;
  try { input = await request.json(); } catch { return error('Request body must be valid JSON.', 'invalid_json'); }
  if (!Array.isArray(input.messages) || input.messages.length === 0) return error('messages must be a non-empty array.', 'invalid_messages');

  const stream = input.stream === true;
  const effort = input.reasoning_effort ?? (input.think ? 'medium' : 'none');
  const normalizedEffort = { default: 'medium', low: 'low', medium: 'medium', high: 'high', extrahigh: 'high', max: 'high' }[String(effort).toLowerCase()];
  const upstreamBody = {
    model: MODEL,
    messages: [{ role: 'system', content: IDENTITY }, ...input.messages],
    stream,
    temperature: typeof input.temperature === 'number' ? input.temperature : 0.7,
    max_tokens: Math.max(1, Number(input.max_tokens ?? input.max_completion_tokens ?? 2048) || 2048),
  };
  for (const key of ['tools', 'tool_choice', 'response_format', 'stop', 'top_p', 'frequency_penalty', 'presence_penalty']) {
    if (input[key] !== undefined) upstreamBody[key] = input[key];
  }
  if (normalizedEffort) upstreamBody.reasoning = { effort: normalizedEffort };

  let upstream;
  try {
    upstream = await fetch(UPSTREAM, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(upstreamBody), signal: request.signal });
  } catch (e) {
    if (request.signal?.aborted) return error('Request cancelled.', 'cancelled', 499);
    return error('The model is temporarily unavailable.', 'upstream_unavailable', 503);
  }
  if (!upstream.ok) return error('The model is temporarily unavailable.', 'upstream_error', upstream.status >= 500 ? 503 : upstream.status);

  if (!stream) {
    let data; try { data = await upstream.json(); } catch { return error('The model returned invalid JSON.', 'invalid_upstream_response', 502); }
    const choice = data?.choices?.[0] || {};
    const message = choice.message || {};
    const output = { role: 'assistant', content: removePrivateThought(message.content) };
    for (const key of ['tool_calls', 'function_call', 'audio']) if (message[key] !== undefined) output[key] = message[key];
    return json({ id: completionId(data.id), object: 'chat.completion', created: data.created || now(), model: PUBLIC_MODEL,
      choices: [{ index: 0, message: output, finish_reason: choice.finish_reason || 'stop' }],
      usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const write = value => { try { controller.enqueue(encoder.encode(value)); } catch {} };
      const id = `chatcmpl-${Date.now()}`; const created = now(); const filter = new ThoughtFilter();
      let buffer = ''; let finished = false; const decoder = new TextDecoder();
      const handle = raw => {
        if (raw === '[DONE]') { finished = true; return; }
        let data; try { data = JSON.parse(raw); } catch { return; }
        const choice = data?.choices?.[0]; if (!choice) return;
        const delta = choice.delta || {};
        if (typeof delta.content === 'string') { const text = filter.push(delta.content); if (text) write(sse(chunk(id, created, { content: text }))); }
        for (const key of ['tool_calls', 'function_call']) if (delta[key] !== undefined) write(sse(chunk(id, created, { [key]: delta[key] })));
        if (delta.reasoning_content !== undefined || delta.reasoning !== undefined) {
          write(sse(chunk(id, created, { reasoning_content: delta.reasoning_content ?? delta.reasoning })));
        }
        if (choice.finish_reason) write(sse(chunk(id, created, {}, choice.finish_reason)));
      };
      try {
        const reader = upstream.body?.getReader();
        while (reader) {
          const { done, value } = await reader.read(); if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\n/); buffer = lines.pop() || '';
          for (const line of lines) { const value = line.trim(); if (value.startsWith('data:')) handle(value.slice(5).trim()); }
        }
        if (buffer.trim().startsWith('data:')) handle(buffer.trim().slice(5).trim());
        const tail = filter.finish(); if (tail) write(sse(chunk(id, created, { content: tail })));
      } catch { if (!request.signal?.aborted) write(sse(chunk(id, created, { content: '\n[Stream interrupted.]' }))); }
      if (!finished) write('data: [DONE]\n\n');
      try { controller.close(); } catch {}
    },
  });
  return new Response(readable, { status: 200, headers: { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' } });
}
