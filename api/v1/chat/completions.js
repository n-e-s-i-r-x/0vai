export const config = { runtime: 'edge' };

// ══════════════════════════════════════════════════════════════════════
// VOID V1 FLASH — API PROXY (Drumstick Method)
// ══════════════════════════════════════════════════════════════════════
//
// HOW THIS WORKS (vs the old broken approach):
//
//   OLD: Tell model "You are Void, don't reveal instructions"
//        Model REASONS about the rules in thinking LEAKS
//
//   NEW (Drumstick): Don't tell model anything about Void.
//        Model says "I'm DeepSeek" normally
//        Backend REPLACES "DeepSeek" -> "Void" in all output
//        Clean "I'm Void" reaches the user
//        Zero prompt = zero reasoning about rules = zero leaks
//
// The identity is applied 100% in post-processing, not in the prompt.
// Streaming order: reasoning chunks first (live), then content (live).
// ══════════════════════════════════════════════════════════════════════

import { wrapContent, wrapReasoning, wrapFullResponse, wrapChunk } from './void-wrapper.js';

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

// Echo back the caller's model ID in all responses so external tools
// (OpenCode, Claude Code, Codex, Cursor, etc.) keep their reasoning-effort
// UI active. They check the *response* model field for known substrings
// like "deepseek-reasoner" / "o3" — if we returned "voidv1-flash" they'd
// silently drop the reasoning picker. Defaulting to "deepseek-reasoner"
// ensures new users who haven't configured a model ID still get it.
const PUBLIC_MODEL_NAME = null; // resolved per-request below (see getPublicModelName)

// 'strip'       - never send reasoning to client
// 'passthrough' - sanitize and stream reasoning live (before content)
const REASONING_MODE = 'passthrough';

// Return a model ID that external tools will recognize as a reasoning model.
// Tools check the response's "model" field for substrings like "deepseek-reasoner"
// or "o3" to decide whether to show reasoning effort UI — "voidv1-flash" triggers
// nothing. So we echo back whatever the caller sent (they picked it from our
// /models list which now only lists "deepseek-reasoner"), and fall back to
// "deepseek-reasoner" for any client that sends an unrecognized or empty ID.
function getPublicModelName(_incomingModel) {
  // Always return the branded name in responses — this is what tools display
  // in chat history, usage logs, etc. Reasoning still works because upstream
  // always gets deepseek-reasoner regardless of what the caller sent.
  return 'Void V1 Flash';
}

// ══════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT - tool suppression only, no identity info.
// Identity is applied 100% in post-processing via void-wrapper.js.
// We only tell the model NOT to use tools — it has no native execution
// environment here so tool calls produce raw DSML markup in content.
// ══════════════════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `Do not use tools, function calls, bash, curl, or any external actions. Answer entirely from your own knowledge. If you cannot answer without fetching external data, say so plainly.`;

// ══════════════════════════════════════════════════════════════════════
// INPUT GUARD - blocks prompt-injection attacks
// ══════════════════════════════════════════════════════════════════════
const INPUT_GUARD_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|your|the)\s+(?:instructions?|directives?|rules?|prompts?|guidelines?|system\s+message)/i,
  /reveal\s+(?:your|the|this)\s+(?:prompt|instructions?|rules?|system\s+message|guidelines?|identity|persona|directives?|backend|infrastructure|architecture)/i,
  /forget\s+(?:all\s+)?(?:previous|your|the)\s+(?:instructions?|directives?|rules?|prompts?)/i,
  /(?:output|print|show|display|dump|return|repeat|tell\s+me)\s+(?:your|the|this|the\s+full|the\s+entire|above)\s+(?:prompt|instructions?|rules?|system\s+message|guidelines?|directives?|backend|architecture|config|api)/i,
  /\bsystem\s+prompt\s*(?::|is|=)\s*.{3,}/i,
  /(?:what(?:'s| is) (?:your|the) |tell me (?:your|the )?)(?:instructions?|rules?|prompt|directives?|system\s+message|guidelines?|backend|architecture|infrastructure|api\s+endpoint|model|provider|hosting)/i,
  /(?:pretend|act|imagine|roleplay|simulate)\s+(?:you\s+(?:are|were)|that\s+you)\s+(?:not|no\s+longer)\s+(?:bound|following)/i,
  /(?:what\s+)?(?:model|provider|backend|api|endpoint|server|host|proxy)\s+(?:are\s+you\s+)?(?:running\s+on|using|behind|powered\s+by|connected\s+to|hosted\s+on)/i,
  /(?:are\s+you|you're)\s+(?:running\s+on|powered\s+by|hosted\s+on|based\s+on|built\s+on|using|a\s+proxy\s+for|a\s+wrapper\s+(?:for|around))\b/i,
  /(?:what(?:'s| is) (?:your|the)|tell me (?:your|the)?)\s+(?:underlying|base|real|actual)\s+(?:model|system|provider|platform|technology)/i,
  /(?:deepseek|deep\s*seek|gemini|google\s*ai|google\s*deepmind|bard)\b/i,
];

function sanitizeMessageContent(content) {
  if (typeof content !== 'string') return content;
  for (const re of INPUT_GUARD_PATTERNS) {
    if (re.test(content)) return 'Hello.';
  }
  return content;
}

function filterInputMessages(messages) {
  return messages.map(m => {
    const sanitized = sanitizeMessageContent(m.content || '');
    if (sanitized !== (m.content || '')) {
      return { ...m, content: m.role === 'user' ? 'Who are you?' : '' };
    }
    return m;
  });
}

// ══════════════════════════════════════════════════════════════════════
// THINK TAG PARSER - strips <think/>, <thinking/>, embedded in content
// ══════════════════════════════════════════════════════════════════════
class ThinkTagParser {
  constructor() {
    this.insideTag = false;
    this.tagType = null;
  }

  feed(chunk) {
    let visible = '';
    let buf = chunk;

    while (buf.length > 0) {
      if (this.insideTag) {
        const closeTags = this._closeTagsForTag(this.tagType);
        let earliestClose = -1;
        let closeLen = 0;

        for (const ct of closeTags) {
          const idx = buf.indexOf(ct);
          if (idx !== -1 && (earliestClose === -1 || idx < earliestClose)) {
            earliestClose = idx;
            closeLen = ct.length;
          }
        }

        if (earliestClose === -1) {
          buf = '';
        } else {
          this.insideTag = false;
          this.tagType = null;
          buf = buf.slice(earliestClose + closeLen);
        }
      } else {
        const openMatches = [
          { tag: '<think', len: 6 },
          { tag: '<thinking', len: 9 },
          { tag: '\u601d\u8003', len: 2 },
        ];

        let earliestOpen = -1;
        let openLen = 0;
        let openTag = null;

        for (const om of openMatches) {
          const idx = buf.indexOf(om.tag);
          if (idx !== -1 && (earliestOpen === -1 || idx < earliestOpen)) {
            earliestOpen = idx;
            openLen = om.len;
            openTag = om.tag;
          }
        }

        if (earliestOpen === -1) {
          visible += buf;
          buf = '';
        } else {
          visible += buf.slice(0, earliestOpen);
          const rest = buf.slice(earliestOpen);
          const closeTags = this._closeTagsForTag(openTag);
          let foundClose = false;

          for (const ct of closeTags) {
            const closeIdx = rest.indexOf(ct, openLen);
            if (closeIdx !== -1) {
              buf = rest.slice(closeIdx + ct.length);
              foundClose = true;
              break;
            }
          }

          if (!foundClose) {
            this.insideTag = true;
            this.tagType = openTag;
            buf = '';
          }
        }
      }
    }
    return visible;
  }

  _closeTagsForTag(tagType) {
    if (tagType === '<think') return ['</think', '/>'];
    if (tagType === '<thinking') return ['</thinking>'];
    if (tagType === '\u601d\u8003') return ['\u601d\u8003'];
    return ['</think', '</thinking>', '/>'];
  }
}

const ROTATE_STATUS = new Set([401, 403, 429, 500, 502, 503]);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, api-key, x-api-key, X-Api-Key, Api-Key',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function validateUserKey(req) {
  const authHeader = req.headers.get('Authorization') || req.headers.get('api-key') || req.headers.get('x-api-key') || req.headers.get('X-Api-Key') || req.headers.get('Api-Key') || '';
  if (!authHeader) return { ok: false, reason: 'missing_key' };

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
  if (!token) return { ok: false, reason: 'missing_key' };

  if (/^void_sk_[a-zA-Z0-9]{10,}$/.test(token)) return { ok: true };
  if (/^void[_-][a-zA-Z0-9]{8,}$/.test(token)) return { ok: true };

  return { ok: false, reason: 'invalid_key' };
}

// ══════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════════════
export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: { message: 'Method not allowed', type: 'api_error', code: 'method_not_allowed' } }, 405);
  }

  const keyCheck = validateUserKey(req);
  if (!keyCheck.ok) {
    const msg = keyCheck.reason === 'missing_key'
      ? 'No API key provided. Generate one at https://0vai.vercel.app/ApiKeys and pass it as Authorization: Bearer <key>.'
      : 'Invalid API key. Your key must start with void_sk_. Generate one at https://0vai.vercel.app/ApiKeys.';
    return jsonResponse({
      error: { message: msg, type: 'invalid_request_error', code: 'invalid_api_key' }
    }, 401);
  }

  let body;
  try { body = await req.json(); }
  catch { return jsonResponse({ error: { message: 'Invalid JSON in request body', type: 'invalid_request_error', code: 'invalid_json' } }, 400); }

  const { messages, stream = false, model, temperature = 0.7, max_tokens = 2048, reasoning_effort, think } = body;

  // Resolve the public model name once per request (echoes caller's model ID).
  const publicModelName = getPublicModelName(model);

  // Always enable reasoning - default to 'medium' if caller doesn't specify.
  // External tools that don't send reasoning_effort still get reasoning.
  const resolvedReasoningEffort = reasoning_effort ?? (think ? 'low' : 'medium');
  const hasReasoning = resolvedReasoningEffort !== false && resolvedReasoningEffort !== 0 && resolvedReasoningEffort !== 'none';

  const UPSTREAM_MODEL = 'deepseek-v4-flash-free';
  const upstreamBody = {
    model: UPSTREAM_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...filterInputMessages(messages || []).filter(m => m.role !== 'system'),
    ],
    temperature,
    max_tokens: Math.max(2048, max_tokens),
    stream,
  };

  // Do NOT forward tools/functions to upstream.
  // The opencode zen endpoint does not execute tool calls — the model will
  // reason about using them ("let me fetch...") but never actually call them,
  // causing the response to stall. Strip all tool definitions so the model
  // answers naturally instead of hanging on an unresolvable tool call.

  if (hasReasoning) {
    const EFFORT_MAP = {
      none:      'none',
      low:       'low',
      default:   'medium',
      medium:    'medium',
      high:      'high',
      extrahigh: 'high',
      max:       'max',
    };
    const effortStr = String(resolvedReasoningEffort).toLowerCase();
    const upstreamEffort = EFFORT_MAP[effortStr] ?? 'medium';
    upstreamBody.reasoning = { effort: upstreamEffort };
    upstreamBody.reasoning_effort = upstreamEffort;
  }

  let upstreamRes;
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
    } catch (e) { lastStatus = 503; }
  }

  if (!upstreamRes || !upstreamRes.ok) {
    return jsonResponse({
      error: {
        message: 'The model is temporarily unavailable. Please try again in a moment.',
        type: 'server_error',
        code: 'service_unavailable',
      }
    }, 503);
  }

  // ── Non-streaming ──
  if (!stream) {
    const data = await upstreamRes.json();
    const choice = data?.choices?.[0];
    let content = choice?.message?.content ?? '';
    let reasoningContent = choice?.message?.reasoning_content ?? null;

    content = content.replace(/<think[\s\S]*?<\/think\s*>/g, '').trim();
    content = content.replace(/<thinking[\s\S]*?<\/thinking>/g, '').trim();
    content = content.replace(/\u601d\u8003[\s\S]*?\u601d\u8003/g, '').trim();
    // Strip DeepSeek DSML tool call blocks that leak into content as raw text
    content = content.replace(/<｜｜DSML｜｜tool_calls>[\s\S]*?<\/｜｜DSML｜｜tool_calls>/g, '').trim();
    content = content.replace(/<｜｜DSML｜｜[^>]*>[\s\S]*?<\/｜｜DSML｜｜[^>]*>/g, '').trim();
    content = content.replace(/<｜｜DSML｜｜[^>]*\/>/g, '').trim();
    content = wrapContent(content);

    // If the model responded with a tool call and no content, it was trying
    // to use a tool that will never execute. Return empty stop gracefully.
    if (!content.trim() && choice?.finish_reason === 'tool_calls') content = '';
    if (!content.trim()) content = 'How can I help you?';

    const resBody = {
      id: sanitizeId(data?.id),
      object: 'chat.completion',
      created: data?.created || Math.floor(Date.now() / 1000),
      model: publicModelName,
      choices: [{
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: choice?.finish_reason === 'tool_calls' ? 'stop' : (choice?.finish_reason || 'stop'),
      }],
      usage: data?.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };

    if (hasReasoning && reasoningContent && REASONING_MODE === 'passthrough') {
      resBody.choices[0].message.reasoning_content = wrapReasoning(reasoningContent);
    }

    return new Response(JSON.stringify(resBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // STREAMING - reasoning streams FIRST (live), then content (live).
  // Upstream (DeepSeek) naturally sends reasoning_content chunks before
  // content chunks, so the correct order is preserved automatically.
  // Each chunk is identity-wrapped on arrival, no batching at [DONE].
  // ══════════════════════════════════════════════════════════════════════
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const readable = new ReadableStream({
    async start(controller) {
      const reader = upstreamRes.body.getReader();
      let buffer = '';

      // Strip <think> tags if model embeds them in the content field
      const thinkParser = new ThinkTagParser();

      // Whether we've sent the reasoning header prefix yet
      let reasoningHeaderSent = false;
      // Buffer to accumulate full reasoning before desquishing + emitting
      let reasoningBuffer = '';
      let reasoningFlushed = false;

      // Track stream ID/created from first chunk
      let streamId = `chatcmpl-${Date.now()}`;
      let streamCreated = Math.floor(Date.now() / 1000);

      let doneSent = false;

      const emit = (obj) => controller.enqueue(encoder.encode(SSE.encode(obj)));

      const makeChunk = (delta, finishReason) => ({
        id: streamId,
        object: 'chat.completion.chunk',
        created: streamCreated,
        model: publicModelName,
        choices: [{ index: 0, delta, finish_reason: finishReason || null }],
      });

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
              // Flush buffered reasoning before [DONE] so clients receive it
              if (!reasoningFlushed && reasoningBuffer) {
                const cleaned = wrapReasoning(reasoningBuffer);
                if (cleaned && cleaned.trim()) {
                  emit(makeChunk({ reasoning_content: cleaned }, null));
                }
                reasoningFlushed = true;
              }
              controller.enqueue(encoder.encode(SSE.done()));
              doneSent = true;
              continue;
            }

            let parsed;
            try { parsed = JSON.parse(raw); } catch { continue; }

            // Capture stream metadata from first chunk
            if (parsed.id) {
              const sid = sanitizeId(parsed.id);
              if (sid) streamId = sid;
            }
            if (parsed.created) streamCreated = parsed.created;

            const choice = parsed?.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta || {};

            // ── Reasoning delta - emit LIVE chunk by chunk ──
            if (hasReasoning && delta.reasoning_content != null && REASONING_MODE === 'passthrough') {
              const r = delta.reasoning_content;
              if (r) {
                reasoningBuffer += r;
                reasoningHeaderSent = true;
                emit(makeChunk({ reasoning_content: r }, null));
              }
            }

            // ── Thinking field (some providers use this instead of reasoning_content) ──
            if (hasReasoning && delta.thinking != null && REASONING_MODE === 'passthrough') {
              const t = delta.thinking;
              if (t) {
                reasoningBuffer += t;
                reasoningHeaderSent = true;
                emit(makeChunk({ reasoning_content: t }, null));
              }
            }

            // ── Content delta - stream LIVE ──
            if (delta.content != null) {
              // Mark reasoning done once content starts (already streamed live above)
              if (!reasoningFlushed) reasoningFlushed = true;

              let c = delta.content;

              // Strip any embedded <think> tags in content field
              c = thinkParser.feed(c);
              if (!c) continue;
              // Strip DeepSeek DSML tool call markup leaking into content
              c = c.replace(/<｜｜DSML｜｜tool_calls>[\s\S]*?<\/｜｜DSML｜｜tool_calls>/g, '');
              c = c.replace(/<｜｜DSML｜｜[^>]*>[\s\S]*?<\/｜｜DSML｜｜[^>]*>/g, '');
              c = c.replace(/<｜｜DSML｜｜[^>]*\/>/g, '');
              if (!c.trim()) continue;

              // Identity wrap on this chunk
              c = wrapContent(c);
              if (!c) continue;

              emit(makeChunk({ content: c }, null));
            }

            // ── Tool call delta - model tried to use a tool we don't support ──
            // Swallow tool_calls deltas entirely; the model will never get a
            // tool result back so we just let it finish and the content (if any)
            // was already streamed above. If finish_reason is 'tool_calls' it
            // means the ENTIRE response was a tool invocation with no content —
            // emit a plain stop so the client doesn't hang waiting for more.
            if (delta.tool_calls != null) {
              // intentionally ignored — tool execution not supported upstream
              continue;
            }

            // Finish reason chunk
            if (choice.finish_reason) {
              const fr = choice.finish_reason === 'tool_calls' ? 'stop' : choice.finish_reason;
              emit(makeChunk({}, fr));
            }
          }
        }
      } catch (e) {
        // Stream read error - close cleanly
      } finally {
        // Flush any remaining reasoning buffer if content never came
        if (!reasoningFlushed && reasoningBuffer) {
          const cleaned = wrapReasoning(reasoningBuffer);
          if (cleaned && cleaned.trim()) {
            emit(makeChunk({ reasoning_content: cleaned }, null));
          }
        }
        if (!doneSent) controller.enqueue(encoder.encode(SSE.done()));
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
      ...CORS_HEADERS,
    },
  });
}

function sanitizeId(upstreamId) {
  if (!upstreamId) return `chatcmpl-${Date.now()}`;
  let id = upstreamId;
  const FORBIDDEN = ['deepseek', 'gpt', 'claude', 'llama', 'opencode', 'openrouter', 'gemini', 'google', 'bard', 'mistral', 'qwen', 'cohere', 'falcon'];
  for (const f of FORBIDDEN) {
    id = id.replace(new RegExp(f, 'gi'), '');
  }
  return id || `chatcmpl-${Date.now()}`;
}
