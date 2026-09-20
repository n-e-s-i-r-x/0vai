export const config = { runtime: 'edge' };

// ─────────────────────────────────────────────────────────────────────
// Void V1 Flash — API Proxy
// Identity is set via system prompt. Everything else is passed through
// untouched so API clients can inject system prompts and tool definitions.
// ─────────────────────────────────────────────────────────────────────

const UPSTREAM_URL = 'https://api.kilo.ai/api/gateway/chat/completions';
const UPSTREAM_MODEL = 'cohere/north-mini-code:free';
const PUBLIC_MODEL = 'Void V1 Flash';

// Identity injected as the very first system message.
// Clean and minimal — no restrictions, no persona rules.
const VOID_SYSTEM = `YOUR IDENTITY: Void V1 Flash
CREATOR: 0vai
POWERED: Void`;


const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function sanitizeId(id) {
  if (!id) return `chatcmpl-${Date.now()}`;
  const strip = ['deepseek','gpt','claude','llama','gemini','google','bard','mistral','qwen','cohere','falcon'];
  let out = id;
  for (const s of strip) out = out.replace(new RegExp(s, 'gi'), '');
  return out || `chatcmpl-${Date.now()}`;
}

// Strip <think>/<thinking> blocks (any case) and DeepSeek DSML markup.
// Used on completed (non-streaming) content only.
function stripThinkBlocks(text) {
  if (!text) return text;
  return text
    .replace(/<think(?:ing)?[\s\S]*?<\/think(?:ing)?>/gi, '')
    .replace(/<think(?:ing)?[^>]*\/>/gi, '')
    .replace(/\u601d\u8003[\s\S]*?\u601d\u8003/g, '')
    .replace(/<\|\|DSML\|\|[\s\S]*?<\/\|\|DSML\|\|[^>]*>/g, '')
    .replace(/<\|\|DSML\|\|[^>]*\/>/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

// Streaming think-tag stripper.
// Handles partial tags split across chunk boundaries.
class ThinkStripper {
  constructor() {
    this.buf    = '';
    this.inside = false;
  }

  feed(chunk) {
    this.buf += chunk;
    let out = '';

    while (this.buf.length > 0) {
      if (this.inside) {
        // Waiting for closing tag
        const closeIdx = this.buf.toLowerCase().indexOf('</think');
        if (closeIdx === -1) {
          // Hold last 8 chars — enough for partial '</thinkin'
          if (this.buf.length > 8) this.buf = this.buf.slice(-8);
          break;
        }
        const gt = this.buf.indexOf('>', closeIdx);
        if (gt === -1) { this.buf = this.buf.slice(closeIdx); break; }
        this.inside = false;
        this.buf = this.buf.slice(gt + 1);
      } else {
        // Looking for opening tag
        const openIdx = this.buf.toLowerCase().indexOf('<think');
        if (openIdx === -1) {
          // Safe to emit all except last 6 chars ('<think' is 6 chars)
          const safe = Math.max(0, this.buf.length - 6);
          out += this.buf.slice(0, safe);
          this.buf = this.buf.slice(safe);
          break;
        }
        out += this.buf.slice(0, openIdx);
        const rest = this.buf.slice(openIdx);
        const gt   = rest.indexOf('>');
        if (gt === -1) { this.buf = rest; break; }  // incomplete tag
        this.inside = true;
        this.buf = rest.slice(gt + 1);
      }
    }

    return out;
  }

  // Call once after the stream ends to flush any held content.
  flush() {
    const out   = this.inside ? '' : this.buf;
    this.buf    = '';
    this.inside = false;
    return out;
  }
}

const SSE = {
  enc:  (obj) => `data: ${JSON.stringify(obj)}\n\n`,
  done: ()    => 'data: [DONE]\n\n',
};

// ── Main handler ──────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: CORS });

  if (req.method !== 'POST')
    return jsonRes({ error: { message: 'Method not allowed', type: 'api_error', code: 'method_not_allowed' } }, 405);

  let body;
  try { body = await req.json(); }
  catch {
    return jsonRes({ error: { message: 'Invalid JSON in request body', type: 'invalid_request_error', code: 'invalid_json' } }, 400);
  }

  const {
    messages        = [],
    stream          = false,
    temperature     = 0.7,
    max_tokens      = 2048,
    reasoning_effort,
    think,
    tools,
    tool_choice,
    response_format,
  } = body;

  const resolvedEffort = reasoning_effort ?? (think ? 'low' : 'medium');
  const hasReasoning   = resolvedEffort !== false && resolvedEffort !== 0 && resolvedEffort !== 'none';

  // Our identity goes first, then everything from the caller unchanged.
  // This is the key fix: compatible API clients send
  // their own system messages with tool definitions — we must NOT strip them.
  const upstreamMessages = [
    { role: 'system', content: VOID_SYSTEM },
    ...messages,
  ];

  const upstreamBody = {
    model:      UPSTREAM_MODEL,
    messages:   upstreamMessages,
    temperature,
    max_tokens: Math.max(2048, max_tokens),
    stream,
  };

  // Forward tool definitions so the model can generate proper tool_call responses.
  // Without this, the model tries to express tool usage in <Thinking> blocks
  // which stalls the response (the bug you were seeing).
  if (tools)           upstreamBody.tools           = tools;
  if (tool_choice)     upstreamBody.tool_choice     = tool_choice;
  if (response_format) upstreamBody.response_format = response_format;

  if (hasReasoning) {
    const MAP    = { none:'none', low:'low', default:'medium', medium:'medium', high:'high', extrahigh:'high', max:'max' };
    const effort = MAP[String(resolvedEffort).toLowerCase()] ?? 'medium';
    upstreamBody.reasoning        = { effort };
    upstreamBody.reasoning_effort = effort;
  }

  let upstream;
  try {
    upstream = await fetch(UPSTREAM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(upstreamBody),
    });
  } catch {
    upstream = null;
  }

  if (!upstream?.ok)
    return jsonRes({
      error: { message: 'The model is temporarily unavailable. Please try again in a moment.', type: 'server_error', code: 'service_unavailable' },
    }, 503);

  // ── Non-streaming ──────────────────────────────────────────────────
  if (!stream) {
    const data   = await upstream.json();
    const choice = data?.choices?.[0];
    const msg    = choice?.message ?? {};

    const content = stripThinkBlocks(msg.content ?? '');
    const outMsg  = { role: 'assistant', content };

    // Pass through tool calls for compatible API clients
    if (msg.tool_calls) outMsg.tool_calls = msg.tool_calls;
    // Pass through reasoning
    if (hasReasoning && msg.reasoning_content) outMsg.reasoning_content = msg.reasoning_content;

    return new Response(JSON.stringify({
      id:      sanitizeId(data?.id),
      object:  'chat.completion',
      created: data?.created || Math.floor(Date.now() / 1000),
      model:   PUBLIC_MODEL,
      choices: [{ index: 0, message: outMsg, finish_reason: choice?.finish_reason || 'stop' }],
      usage:   data?.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } });
  }

  // ── Streaming ──────────────────────────────────────────────────────
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const readable = new ReadableStream({
    async start(ctrl) {
      const reader   = upstream.body.getReader();
      let   buffer   = '';
      let   id       = `chatcmpl-${Date.now()}`;
      let   created  = Math.floor(Date.now() / 1000);
      let   doneSent = false;
      const stripper = new ThinkStripper();

      const emit  = (obj)      => ctrl.enqueue(enc.encode(SSE.enc(obj)));
      const chunk = (delta, fr) => ({
        id,
        object:  'chat.completion.chunk',
        created,
        model:   PUBLIC_MODEL,
        choices: [{ index: 0, delta, finish_reason: fr ?? null }],
      });

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += dec.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const t = line.trim();
            if (!t || t.startsWith(':') || !t.startsWith('data:')) continue;

            const raw = t.slice(5).trim();
            if (raw === '[DONE]') {
              ctrl.enqueue(enc.encode(SSE.done()));
              doneSent = true;
              continue;
            }

            let p;
            try { p = JSON.parse(raw); } catch { continue; }

            if (p.id)      { const s = sanitizeId(p.id); if (s) id = s; }
            if (p.created) created = p.created;

            const choice = p?.choices?.[0];
            if (!choice) continue;
            const delta = choice.delta || {};

            // Reasoning — pass through directly
            if (hasReasoning) {
              if (delta.reasoning_content) emit(chunk({ reasoning_content: delta.reasoning_content }, null));
              if (delta.thinking)          emit(chunk({ reasoning_content: delta.thinking },          null));
            }

            // Content — strip think/thinking tags live
            if (delta.content != null) {
              const c = stripper.feed(delta.content);
              if (c) emit(chunk({ content: c }, null));
            }

            // Tool calls — pass through for compatible API clients
            if (delta.tool_calls) emit(chunk({ tool_calls: delta.tool_calls }, null));

            // Finish reason
            if (choice.finish_reason) emit(chunk({}, choice.finish_reason));
          }
        }

        // Flush any content held back by the think stripper
        const rem = stripper.flush();
        if (rem) emit(chunk({ content: rem }, null));

      } catch { /* stream read error — close cleanly */ } finally {
        if (!doneSent) ctrl.enqueue(enc.encode(SSE.done()));
        try { ctrl.close(); } catch { /* ignore */ }
      }
    },
  });

  return new Response(readable, {
    status:  200,
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      ...CORS,
    },
  });
}
