export const config = { runtime: 'edge' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, api-key, x-api-key, X-Api-Key, Api-Key',
};

// ══════════════════════════════════════════════════════════════════════
// THE REAL ROOT CAUSE (finally figured out after reading actual source):
//
// OpenCode's transform.ts calls openaiCompatibleReasoningEfforts(modelId)
// which checks if the model ID string CONTAINS known patterns:
//   "o1", "o3", "o4", "gpt-5", "deepseek-reasoner", "deepseek-v4"
//
// The OpenCode Zen deepseek-v4-flash model shows the picker because
// OpenCode's INTERNAL provider definition hardcodes it — not because
// of anything in the /v1/models JSON response.
//
// When users add YOUR API as a custom openai-compatible provider,
// OpenCode runs openaiCompatibleReasoningEfforts() on whatever model
// ID you return. "voidv1-flash" → no match → no picker. Always.
//
// FIX: expose the model with IDs that contain the magic strings.
// The primary display name stays "Void V1 Flash" — branding is fine
// because void-wrapper.js strips all deepseek refs from responses.
// "deepseek-v4-flash" is the cleanest match — OpenCode knows it
// supports reasoning_effort: low/medium/high/max natively.
// ══════════════════════════════════════════════════════════════════════

const SHARED = {
  object:       'model',
  created:      1700000000,
  owned_by:     'void',
  name:         'Void V1 Flash',
  display_name: 'Void V1 Flash',
  description:  'Advanced reasoning model by 0vai. Configurable effort: none → max.',
  type:         'chat',

  context_length:        1000000,
  context_window:        1000000,
  max_output_tokens:     32000,
  max_completion_tokens: 32000,
  max_tokens:            32000,

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

  const models = [
    // ── Primary branded ID (used by the web app UI) ──
    { ...SHARED, id: 'voidv1-flash' },

    // ── Magic-string aliases for tool detection ──
    //
    // Tools check model ID for known substrings to show the reasoning picker.
    // These IDs contain the trigger strings. The display name stays "Void V1 Flash".
    // void-wrapper.js scrubs all deepseek/o3 refs from responses so branding is clean.
    //
    // "deepseek-v4-flash"  → OpenCode, Kilo, Cursor recognize "deepseek-v4" → picker shown
    // "o3-mini"            → OpenCode, Cursor, Windsurf, Claude Code recognize "o3" → picker shown
    { ...SHARED, id: 'deepseek-v4-flash', name: 'Void V1 Flash' },
    { ...SHARED, id: 'o3-mini',           name: 'Void V1 Flash' },
  ];

  return new Response(JSON.stringify({ object: 'list', data: models }), {
    status:  200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
