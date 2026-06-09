export const config = { runtime: 'edge' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, api-key, x-api-key, X-Api-Key, Api-Key',
};

// ══════════════════════════════════════════════════════════════════════
// HOW TOOLS DETECT REASONING EFFORT:
//
//   OpenCode / Kilo / Cursor / Windsurf / Claude Code all use different
//   detection paths. To cover all of them:
//
//   1. supported_parameters includes "reasoning_effort"
//      → OpenRouter-style tools show a picker
//
//   2. variants object on each model
//      → OpenCode's openai-compatible loader reads this directly
//
//   3. Separate per-effort model entries (voidv1-flash-low, etc.)
//      → Tools that only show effort when they see known model ID suffixes
//        (-low, -medium, -high, -max) get a guaranteed hit
//
//   4. Model ID contains "flash" which some tools use as a reasoning signal
// ══════════════════════════════════════════════════════════════════════

const BASE = {
  object:                      'model',
  created:                     1700000000,
  owned_by:                    'void',
  name:                        'Void V1 Flash',
  display_name:                'Void V1 Flash',
  description:                 'Advanced high-reasoning model optimized for coding, planning, and complex agent workflows with up to 1M token context and configurable reasoning effort.',
  type:                        'chat',

  context_length:              1000000,
  context_window:              1000000,
  max_output_tokens:           32000,
  max_completion_tokens:       32000,
  max_tokens:                  32000,

  // ── Reasoning flags — every format tools might check ──
  reasoning:                   true,
  reasoning_effort:            true,
  supports_reasoning:          true,
  supports_reasoning_effort:   true,
  has_reasoning:               true,
  forceReasoning:              true,
  thinking:                    true,
  supports_thinking:           true,
  reasoning_effort_default:    'medium',
  reasoning_effort_levels:     ['none', 'low', 'medium', 'high', 'max'],

  // ── supported_parameters — OpenRouter / Cursor / Windsurf check this ──
  supported_parameters: [
    'reasoning_effort',
    'reasoning',
    'stream',
    'temperature',
    'max_tokens',
    'tools',
    'tool_choice',
    'response_format',
  ],

  // ── top_provider — OpenRouter format, OpenCode Zen reads this ──
  top_provider: {
    context_length:            1000000,
    max_completion_tokens:     32000,
    reasoning:                 true,
    reasoning_effort:          true,
    supports_reasoning_effort: true,
    reasoning_effort_default:  'medium',
    is_moderated:              false,
  },

  // ── capabilities — Claude Code + OpenCode check this ──
  capabilities: {
    reasoning:                 true,
    reasoning_effort:          true,
    supports_reasoning_effort: true,
    thinking:                  true,
    supports_thinking:         true,
    tools:                     true,
    tool_choice:               true,
    streaming:                 true,
    response_format:           true,
    function_calling:          true,
    parallel_tool_calls:       true,
    vision:                    false,
  },

  // ── variants — OpenCode openai-compatible loader reads this directly ──
  // This is the key field that makes the reasoning picker appear in OpenCode TUI
  variants: {
    none:   { reasoningEffort: 'none'   },
    low:    { reasoningEffort: 'low'    },
    medium: { reasoningEffort: 'medium' },
    high:   { reasoningEffort: 'high'   },
    max:    { reasoningEffort: 'max'    },
  },

  // ── Architecture ──
  architecture: {
    modality:      'text->text',
    tokenizer:     'Other',
    instruct_type: 'none',
    input_modalities:  ['text'],
    output_modalities: ['text'],
  },

  // ── Pricing (free) ──
  pricing: {
    prompt:     '0',
    completion: '0',
    image:      '0',
    request:    '0',
  },

  per_request_limits: null,
};

// ── Primary model entry (full picker visible in tools that read variants/supported_parameters) ──
const PRIMARY = { ...BASE, id: 'voidv1-flash' };

// ── Per-effort alias entries (for tools that only show effort on known ID suffixes) ──
// These map to the same backend but expose effort in the model name/ID so
// tools like Cursor, Windsurf, and older OpenCode builds can show the right badge.
const EFFORT_ALIASES = [
  { id: 'voidv1-flash-none',   display_name: 'Void V1 Flash (None)',   reasoning_effort_default: 'none',   _effort: 'none'   },
  { id: 'voidv1-flash-low',    display_name: 'Void V1 Flash (Low)',    reasoning_effort_default: 'low',    _effort: 'low'    },
  { id: 'voidv1-flash-medium', display_name: 'Void V1 Flash (Medium)', reasoning_effort_default: 'medium', _effort: 'medium' },
  { id: 'voidv1-flash-high',   display_name: 'Void V1 Flash (High)',   reasoning_effort_default: 'high',   _effort: 'high'   },
  { id: 'voidv1-flash-max',    display_name: 'Void V1 Flash (Max)',    reasoning_effort_default: 'max',    _effort: 'max'    },
].map(({ _effort, ...alias }) => ({
  ...BASE,
  ...alias,
  name: alias.display_name,
  description: `Void V1 Flash with reasoning effort set to ${_effort}.`,
  variants: { [_effort]: { reasoningEffort: _effort } },
}));

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
    data: [PRIMARY, ...EFFORT_ALIASES],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
