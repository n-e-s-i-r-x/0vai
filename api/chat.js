export const config = { runtime: 'edge' };

const UPSTREAM = 'https://api.kilo.ai/api/gateway/chat/completions';
const MODELS = {
  '0': { id: 'liquid/lfm-2.5-2.6b:free', reasoning: false },
  '00': { id: 'kilo-auto/free', reasoning: true },
  '000': { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', reasoning: true },
  V: { id: 'inclusionai/ling-3.0-flash-vl:free', reasoning: true, vision: true },
  VV: { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', reasoning: true, agent: true },
  VVV: { id: 'nex-agi/nex-n2.5-pro:free', reasoning: true },
  humanizer: { id: 'openai/gpt-oss-120b:free', reasoning: false, temperature: 1.2 },
};
const FALLBACK = MODELS['0'];
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const sse = value => `data: ${JSON.stringify(value)}\n\n`;
const content = text => sse({ choices: [{ delta: { content: text }, finish_reason: null }] });
const done = 'data: [DONE]\n\n';

const BASE_PROMPT = `You are 0, a helpful assistant created by vin and powered by void. Be accurate, direct, and useful. Match the user's language and requested level of detail. Use markdown only when it improves readability. Never invent facts. Do not use em dashes.`;
const BUILDER_PROMPT = `${BASE_PROMPT}\nWhen building software, output each file in this exact format and include complete contents:\n[FILE:path/to/file]\nfile contents\n[/FILE]\nDo not omit code with placeholders. Keep the explanation outside file markers.`;

function modelFor(key) { return MODELS[key] || FALLBACK; }
function textOf(message) {
  if (typeof message?.content === 'string') return message.content;
  if (Array.isArray(message?.content)) return message.content.map(x => x?.text || '').join(' ');
  return '';
}
function validMessages(list) { return (Array.isArray(list) ? list : []).filter(m => m && ['system', 'user', 'assistant', 'tool'].includes(m.role) && (typeof m.content === 'string' || Array.isArray(m.content))).slice(-40); }
function effort(value) { return { rapid: 'low', default: 'medium', low: 'low', medium: 'medium', high: 'high', max: 'high' }[String(value || 'medium').toLowerCase()] || 'medium'; }
function isBuildRequest(text) { return /\b(build|create|make|generate|write|implement|website|web app|component|dashboard|landing page|calculator|todo|game|fix|refactor)\b/i.test(text); }
function safeJson(value) { try { return JSON.stringify(value); } catch { return '{}'; } }

async function upstreamStream({ request, messages, model, temperature, maxTokens, reasoning, send }) {
  const body = { model: model.id, messages, stream: true, temperature, max_tokens: maxTokens };
  if (reasoning) body.reasoning = { effort: reasoning };
  let response;
  try { response = await fetch(UPSTREAM, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: safeJson(body), signal: request.signal }); }
  catch { send(content(request.signal?.aborted ? '\n[Stopped]' : 'Network error. Please try again.')); return; }
  if (!response.ok) { send(content('The model is temporarily unavailable. Please try again.')); return; }
  if (!response.body) { send(content('No response was generated.')); return; }
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  try {
    while (true) {
      const { done: ended, value } = await reader.read(); if (ended) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim(); if (!trimmed.startsWith('data:')) continue;
        const raw = trimmed.slice(5).trim(); if (raw === '[DONE]') continue;
        try {
          const delta = JSON.parse(raw)?.choices?.[0]?.delta || {};
          if (typeof delta.reasoning_content === 'string' && reasoning) send(content(`<think>${delta.reasoning_content}</think>`));
          if (typeof delta.content === 'string') send(content(delta.content));
        } catch {}
      }
    }
  } catch { if (!request.signal?.aborted) send(content('\n[Stream interrupted. Please try again.]')); }
}

async function runAgent({ request, history, workspace, model, effortLevel, send }) {
  const files = workspace?.files && typeof workspace.files === 'object' ? workspace.files : {};
  const summary = Object.entries(files).map(([name, value]) => `${name} (${String(value).length} chars)`).join(', ') || '(empty workspace)';
  const agentMessages = [
    { role: 'system', content: `${BUILDER_PROMPT}\nCurrent workspace: ${summary}` },
    ...history,
  ];
  const steps = ['Initializing task', 'Analyzing request', 'Planning architecture', 'Generating code', 'Validating output', 'Finalizing build'];
  send(sse({ agent: { type: 'plan', steps, ids: steps.map((_, i) => `step_${i}`) } }));
  send(sse({ agent: { type: 'log', level: 'info', line: 'Generating a complete implementation...' } }));
  let full = '';
  const collect = chunk => { try { const parsed = JSON.parse(chunk.slice(6)); const value = parsed?.choices?.[0]?.delta?.content; if (value) full += value; } catch {} send(chunk); };
  await upstreamStream({ request, messages: agentMessages, model, temperature: 0.4, maxTokens: 100000, reasoning: effortLevel, send: collect });
  const generated = {};
  const pattern = /\[FILE:\s*([^\]]+)\]([\s\S]*?)\[\/FILE\]/g; let match;
  while ((match = pattern.exec(full))) { const path = match[1].trim().replace(/^\.?\//, ''); if (path && !path.includes('..')) generated[path] = match[2].trim(); }
  if (Object.keys(generated).length) {
    const merged = { ...files, ...generated };
    send(sse({ agent: { type: 'workspace', files: merged, entry: '' } }));
    send(sse({ agent: { type: 'log', level: 'info', line: `${Object.keys(generated).length} file(s) generated.` } }));
  }
  send(sse({ agent: { type: 'done', files: { ...files, ...generated }, entry: '' } }));
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method === 'GET') return json(Object.fromEntries(Object.entries(MODELS).map(([key, value]) => [key, { think: value.reasoning }])));
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let body; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const history = validMessages(body.messages);
  if (!history.length) return json({ error: 'messages must contain at least one message' }, 400);
  const key = String(body.model || '0'); const model = modelFor(key);
  const last = textOf([...history].reverse().find(x => x.role === 'user'));
  const agent = model.agent && isBuildRequest(last) && !/^(hi|hey|hello|thanks|ok|okay)\b/i.test(last);
  const system = body.context ? `${agent ? BUILDER_PROMPT : BASE_PROMPT}\n\nAdditional context:\n${String(body.context).slice(0, 30000)}` : (agent ? BUILDER_PROMPT : BASE_PROMPT);
  const messages = [{ role: 'system', content: system }, ...history];
  const encoder = new TextEncoder();
  const stream = new ReadableStream({ async start(controller) {
    const send = value => { try { controller.enqueue(encoder.encode(value)); } catch {} };
    try {
      if (agent) await runAgent({ request, history, workspace: body.workspace, model, effortLevel: effort(body.reasoningEffort), send });
      else await upstreamStream({ request, messages, model, temperature: Number(body.temperature ?? model.temperature ?? 0.7), maxTokens: Math.max(1, Number(body.maxTokens ?? 8192) || 8192), reasoning: model.reasoning && body.think ? effort(body.reasoningEffort) : null, send });
    } catch { send(content('Something went wrong while generating the response.')); }
    send(done); try { controller.close(); } catch {}
  } });
  return new Response(stream, { status: 200, headers: { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' } });
}
