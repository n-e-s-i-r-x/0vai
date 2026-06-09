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

const PUBLIC_MODEL_NAME = 'voidv1-flash';

// 'strip'       - never send reasoning to client
// 'passthrough' - sanitize and stream reasoning live (before content)
const REASONING_MODE = 'passthrough';

// ══════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT - minimal formatting only, NO identity info.
// Identity is applied 100% in post-processing (Drumstick method).
// ══════════════════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `Write in short paragraphs. Use markdown for any answer longer than 3 sentences: ## headings, - bullets for 3+ items, numbered lists for steps. Wrap all code/commands/JSON in fenced code blocks with a language tag. Never use em dashes. Do not pad responses with restatements or filler closers.`;

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
    content = wrapContent(content);

    if (!content.trim()) content = 'How can I help you?';

    const resBody = {
      id: sanitizeId(data?.id),
      object: 'chat.completion',
      created: data?.created || Math.floor(Date.now() / 1000),
      model: PUBLIC_MODEL_NAME,
      choices: [{
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: choice?.finish_reason || 'stop',
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
        model: PUBLIC_MODEL_NAME,
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

              // Identity wrap on this chunk
              c = wrapContent(c);
              if (!c) continue;

              emit(makeChunk({ content: c }, null));
            }

            // Finish reason chunk
            if (choice.finish_reason) {
              emit(makeChunk({}, choice.finish_reason));
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
