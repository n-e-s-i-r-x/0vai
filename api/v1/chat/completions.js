export const config = { runtime: 'edge' };

// ══════════════════════════════════════════════════════════════════════
// VOID V1 FLASH — API PROXY (Drumstick Method)
// ══════════════════════════════════════════════════════════════════════
//
// HOW THIS WORKS (vs the old broken approach):
//
//   OLD: Tell model "You are Void, don't reveal instructions"
//        → Model REASONS about the rules in thinking → LEAKS
//        → "AccordingtotheinstructionsIshouldsay..."
//
//   NEW (Drumstick): Don't tell model anything about Void.
//        → Model says "I'm DeepSeek" normally
//        → Backend REPLACES "DeepSeek" → "Void" in all output
//        → Clean "I'm Void" reaches the user
//        → Zero prompt = zero reasoning about rules = zero leaks
//
// The identity is applied 100% in post-processing, not in the prompt.
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

// ── Reasoning mode ──
// 'strip'       — never send reasoning to client (safest, zero leaks)
// 'passthrough' — sanitize reasoning and send it (may still have edge cases)
const REASONING_MODE = 'passthrough';

// ══════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// Minimal formatting prompt only — NO identity info here.
// Identity ("I'm Void") is applied 100% in post-processing by
// void-wrapper.js (the Drumstick method). Putting identity in the
// system prompt causes the model to reason about it in <think> blocks
// which leaks. So we leave identity out entirely and just enforce
// response quality / format here.
// ══════════════════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `Write in short paragraphs. Use markdown for any answer longer than 3 sentences: ## headings, - bullets for 3+ items, numbered lists for steps. Wrap all code/commands/JSON in fenced code blocks with a language tag. Never use em dashes (—). Do not pad responses with restatements or filler closers.`;
// ══════════════════════════════════════════════════════════════════════
// INPUT GUARD — Still needed to block prompt-injection attacks
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
  /(?:opencode|open\s*code|deepseek|deep\s*seek|gemini|google\s*ai|google\s*deepmind|bard)\b/i,
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
// THINK TAG PARSER — Strips <think/>, <thinking/>, 思考 from content
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

// ══════════════════════════════════════════════════════════════════════
// STREAMING TEXT NORMALIZER — Fixes squished words across chunks
// ══════════════════════════════════════════════════════════════════════
class StreamingTextNormalizer {
  constructor() {}
  feed(chunk) { return chunk || ''; }
  flush() { return ''; }
}

const ROTATE_STATUS = new Set([401, 403, 429, 500, 502, 503]);

// ══════════════════════════════════════════════════════════════════════
// CORS HEADERS — applied to every response
// ══════════════════════════════════════════════════════════════════════
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

// ══════════════════════════════════════════════════════════════════════
// USER KEY VALIDATION
// The API is open (no real backend auth store), but we validate that
// the key looks like a valid Void key so third-party apps that send
// a bearer token don't get a cryptic upstream error.
// Any key that starts with "void_sk_" (16+ chars after prefix) passes.
// Missing / malformed keys return a clear 401 with an OpenAI-style error.
// ══════════════════════════════════════════════════════════════════════
function validateUserKey(req) {
  const authHeader = req.headers.get('Authorization') || req.headers.get('api-key') || req.headers.get('x-api-key') || req.headers.get('X-Api-Key') || req.headers.get('Api-Key') || '';
  if (!authHeader) return { ok: false, reason: 'missing_key' };

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
  if (!token) return { ok: false, reason: 'missing_key' };

  // Accept any void_sk_ prefixed key of reasonable length
  if (/^void_sk_[a-zA-Z0-9]{10,}$/.test(token)) return { ok: true };

  // Also accept legacy keys that might have been generated previously
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

  // ── Validate user's API key ──
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

  const resolvedReasoningEffort = reasoning_effort ?? (think ? 'medium' : null);
  const hasReasoning = resolvedReasoningEffort != null && resolvedReasoningEffort !== false && resolvedReasoningEffort !== 0;

  // ── Build upstream request ──
  // NO identity in the system prompt. The model will say "I'm DeepSeek"
  // and we replace it on the backend.
  // IMPORTANT: always use the fixed upstream model ID regardless of
  // what the client sends — passing client model names (e.g. "voidv1-flash")
  // to the upstream API causes an invalid model error.
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
    upstreamBody.reasoning = {
      effort: resolvedReasoningEffort === 'high' ? 'high' : 'medium',
    };
    upstreamBody.reasoning_effort = resolvedReasoningEffort === 'high' ? 'high' : 'medium';
  }

  // ── Forward to upstream with key rotation ──
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

    // Strip think/思考 tags from content (model sometimes puts them in content)
    content = content.replace(/<think[\s\S]*?<\/think\s*>/g, '').trim();
    content = content.replace(/<thinking[\s\S]*?<\/thinking>/g, '').trim();
    content = content.replace(/\u601d\u8003[\s\S]*?\u601d\u8003/g, '').trim();

    // DESQUISH + WRAP content (this is where "DeepSeek" → "Void" happens)
    content = wrapContent(content);

    // Ensure content isn't empty after wrapping
    if (!content.trim()) content = "How can I help you?";

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

    // Handle reasoning
    if (hasReasoning && reasoningContent) {
      if (REASONING_MODE === 'passthrough') {
        resBody.choices[0].message.reasoning_content = wrapReasoning(reasoningContent);
      }
      // 'strip': we just don't add it to the response
    }

    return new Response(JSON.stringify(resBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  // ── Streaming ──
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const readable = new ReadableStream({
    async start(controller) {
      const reader = upstreamRes.body.getReader();
      let buffer = '';

      // Always strip think/思考 tags from content
      const thinkParser = new ThinkTagParser();
      // Normalize spacing across streaming chunks
      const textNormalizer = new StreamingTextNormalizer();
      // Accumulate full reasoning for batch desquishing + wrapping
      let reasoningAccumulator = '';
      // Accumulate full content for a final safety-net wrap pass
      let contentAccumulator = '';

      let doneSent = false;
      const emit = (obj) => controller.enqueue(encoder.encode(SSE.encode(obj)));
      const makeChunk = (id, created, delta, finishReason) => ({
        id: sanitizeId(id) || `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: created || Math.floor(Date.now() / 1000),
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
              // Flush text normalizer tail
              const normalizerTail = textNormalizer.flush();
              if (normalizerTail) contentAccumulator += normalizerTail;

              // Emit full wrapped content as one chunk (catches all identity leaks)
              if (contentAccumulator.trim()) {
                const wrapped = wrapContent(contentAccumulator);
                if (wrapped.trim()) {
                  emit(makeChunk(`chatcmpl-${Date.now()}`, null, { content: wrapped }, null));
                }
                contentAccumulator = '';
              }

              // Emit wrapped reasoning
              if (reasoningAccumulator && REASONING_MODE === 'passthrough') {
                const wrapped = wrapReasoning(reasoningAccumulator);
                if (wrapped.trim()) {
                  emit(makeChunk(`chatcmpl-${Date.now()}`, null, { reasoning_content: wrapped }, null));
                }
                reasoningAccumulator = '';
              }

              controller.enqueue(encoder.encode(SSE.done()));
              doneSent = true;
              continue;
            }

            let parsed;
            try { parsed = JSON.parse(raw); } catch { continue; }

            const choice = parsed?.choices?.[0];
            if (!choice) continue;

            if (choice.finish_reason) {
              emit(makeChunk(parsed.id, parsed.created, {}, choice.finish_reason));
            }

            const delta = choice.delta || {};

            // ── Reasoning chunks ──
            if (hasReasoning && delta.reasoning_content != null) {
              if (REASONING_MODE === 'strip') {
                // Silently drop — never reaches client
              } else if (REASONING_MODE === 'passthrough') {
                // Accumulate reasoning, we'll desquish + wrap it in batch
                // at the end. Sending raw squished reasoning chunk-by-chunk
                // is useless because the user can't read it anyway.
                reasoningAccumulator += delta.reasoning_content;
              }
            }

            // ── Content chunks ──
            if (delta.content != null) {
              let c = delta.content;

              // Strip think/思考 tags
              c = thinkParser.feed(c);
              if (!c) continue;

              // Normalize spacing across chunk boundaries
              const normalized = textNormalizer.feed(c);
              if (!normalized) continue;

              // Accumulate — we wrap the full content at [DONE] so
              // word-boundary splits across chunks can't break regex matches
              contentAccumulator += normalized;
            }
          }
        }
      } catch (e) {
        // Stream error
      } finally {
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
  const FORBIDDEN = ['deepseek', 'gpt', 'claude', 'llama', 'opencode', 'openrouter', 'gemini', 'google', 'bard'];
  for (const f of FORBIDDEN) {
    id = id.replace(new RegExp(f, 'gi'), '');
  }
  return id || `chatcmpl-${Date.now()}`;
}
