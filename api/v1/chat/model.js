export const config = { runtime: 'edge' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, api-key, x-api-key, X-Api-Key, Api-Key',
};

const SHARED = {
  object:       'model',
  created:      1700000000,
  owned_by:     'void',
  name:         'Void V1 Flash',
  display_name: 'Void V1 Flash',
  description:  'Void V1 Flash — advanced reasoning model by 0vai.',
  type:         'chat',

  context_length:        1000000,
  context_window:        1000000,
  max_output_tokens:     32000,
  max_completion_tokens: 32000,
  max_tokens:            32000,

  // Every tool checks this array differently — cover all known strings
  supported_parameters: [
    'reasoning_effort', 'reasoning', 'max_tokens',
    'temperature', 'stream', 'tools', 'tool_choice', 'response_format',
  ],

  capabilities: {
    reasoning: true, reasoning_effort: true,
    thinking: true, tools: true, streaming: true,
    function_calling: true, parallel_tool_calls: true,
  },

  pricing: { prompt: '0', completion: '0', image: '0', request: '0' },
  per_request_limits: null,
};

export default function handler(req) {
  if (req.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: CORS_HEADERS });

  if (req.method !== 'GET' && req.method !== 'POST')
    return new Response(
      JSON.stringify({ error: { message: 'Method not allowed', type: 'api_error', code: 405 } }),
      { status: 405, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
    );

  // ── Why these specific IDs ──────────────────────────────────────────
  //
  // Every tool (OpenCode, Cursor, Windsurf, Claude Code, Continue, etc)
  // checks if the model ID *contains* one of these exact substrings to
  // decide whether to show the reasoning effort picker. It does NOT read
  // any metadata fields from this JSON. The substring check is hardcoded
  // in their source.
  //
  // Confirmed trigger strings (works in ALL tools):
  //   "deepseek-reasoner"  → universally recognized, every tool has this
  //   "deepseek-v4"        → OpenCode, Kilo, Cursor
  //   "o3"                 → OpenCode, Cursor, Windsurf, Claude Code
  //
  // void-wrapper.js scrubs "deepseek" and "o3" from all responses, so
  // the user always sees "Void V1 Flash" branding regardless of model ID.
  // completions.js ignores the incoming model field and routes everything
  // to deepseek-v4-flash-free upstream.
  // ───────────────────────────────────────────────────────────────────

  const models = [
    // Primary — for your own web app
    { ...SHARED, id: 'voidv1-flash' },

    // Reasoning picker triggers — tell users to pick one of these in tools
    { ...SHARED, id: 'deepseek-reasoner',   name: 'Void V1 Flash' },
    { ...SHARED, id: 'deepseek-v4-flash',   name: 'Void V1 Flash' },
    { ...SHARED, id: 'o3-mini',             name: 'Void V1 Flash' },
  ];

  return new Response(JSON.stringify({ object: 'list', data: models }), {
    status:  200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
