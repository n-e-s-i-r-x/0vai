export const config = { runtime: 'edge' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, api-key, x-api-key, X-Api-Key, Api-Key',
};

// ══════════════════════════════════════════════════════════════════════
// WHY THE REASONING PICKER WASN'T SHOWING — ROOT CAUSE:
//
// OpenCode / Cursor / Windsurf / Claude Code do NOT read your model
// metadata JSON fields (reasoning:true, supported_parameters, etc.)
// to decide whether to show the reasoning effort picker.
//
// OpenCode uses Vercel AI SDK internally. Its transform.ts variants()
// function checks model.api.npm (the SDK package) and model.api.id
// (the raw model ID string) against hardcoded patterns:
//   - contains "o1", "o3", "o4" → OpenAI reasoning
//   - contains "deepseek-reasoner" → DeepSeek reasoning
//   - etc.
//
// For openai-compatible custom providers, the Vercel AI SDK checks if
// the model ID starts with "o1" / "o3" / "o4" OR has forceReasoning.
// But forceReasoning is a provider-level SDK flag, not a JSON field.
//
// THE ACTUAL FIX:
// 1. Primary model ID is "voidv1-flash" — stays as-is for the app
// 2. Also expose an alias "o1-voidv1-flash" so tools that check for
//    "o1" prefix automatically enable reasoning effort picker
// 3. The completions.js maps both IDs to the same upstream model
// 4. For tools that read supported_parameters, keep that array
//
// For OpenCode specifically, users need one line in opencode.json:
//   "variants": { "low": {...}, "medium": {...}, "high": {...} }
// We return this in the model object so clients that DO read it work.
// ══════════════════════════════════════════════════════════════════════

const EFFORTS = ['none', 'low', 'medium', 'high', 'max'];

const BASE_CAPS = {
  object:                    'model',
  created:                   1700000000,
  owned_by:                  'void',

  // Both name forms — tools check different fields
  name:                      'Void V1 Flash',
  display_name:              'Void V1 Flash',
  description:               'Advanced reasoning model by 0vai. Configurable effort: none → max.',

  type:                      'chat',
  context_length:            1000000,
  context_window:            1000000,
  max_output_tokens:         32000,
  max_completion_tokens:     32000,
  max_tokens:                32000,

  // ── supported_parameters — Cursor / Windsurf / OpenRouter-style tools ──
  supported_parameters: [
    'reasoning_effort',
    'reasoning',
    'max_tokens',
    'temperature',
    'stream',
    'tools',
    'tool_choice',
    'response_format',
  ],

  // ── top_provider — OpenRouter format ──
  top_provider: {
    context_length:            1000000,
    max_completion_tokens:     32000,
    is_moderated:              false,
  },

  // ── capabilities ──
  capabilities: {
    reasoning:                 true,
    reasoning_effort:          true,
    supports_reasoning_effort: true,
    thinking:                  true,
    tools:                     true,
    streaming:                 true,
    function_calling:          true,
    parallel_tool_calls:       true,
  },

  // ── variants — OpenCode openai-compatible loader reads this ──
  variants: Object.fromEntries(
    EFFORTS.map(e => [e, { reasoningEffort: e }])
  ),

  // ── architecture ──
  architecture: {
    modality:          'text->text',
    tokenizer:         'Other',
    instruct_type:     'none',
    input_modalities:  ['text'],
    output_modalities: ['text'],
  },

  pricing: { prompt: '0', completion: '0', image: '0', request: '0' },
  per_request_limits: null,
};

// ── Model entries ──────────────────────────────────────────────────────
//
// "voidv1-flash"       — primary ID used by the app
// "o3-voidv1-flash"    — o3-prefixed alias: tools that check for "o3"
//                        in the ID (OpenCode transform.ts, Cursor, etc.)
//                        automatically enable the reasoning effort picker
//
// Both route to the same backend in completions.js.

const MODELS = [
  {
    ...BASE_CAPS,
    id: 'voidv1-flash',
  },
  {
    ...BASE_CAPS,
    id: 'o3-voidv1-flash',
    name: 'Void V1 Flash (o3)',
    display_name: 'Void V1 Flash',
    description: 'Void V1 Flash — o3-compatible alias for tools that detect reasoning via model ID prefix.',
  },
];

export default function handler(req) {
  if (req.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: CORS_HEADERS });

  if (req.method !== 'GET' && req.method !== 'POST')
    return new Response(
      JSON.stringify({ error: { message: 'Method not allowed', type: 'api_error', code: 405 } }),
      { status: 405, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
    );

  return new Response(JSON.stringify({
    object: 'list',
    data:   MODELS,
  }), {
    status:  200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
