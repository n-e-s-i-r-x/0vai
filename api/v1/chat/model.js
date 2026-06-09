export const config = { runtime: 'edge' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, api-key, x-api-key, X-Api-Key, Api-Key',
};

const REASONING_EFFORT_LEVELS = ['default', 'low', 'medium', 'high', 'extrahigh', 'max'];

export default function handler(req) {
  if (req.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: CORS_HEADERS });

  if (req.method !== 'GET' && req.method !== 'POST')
    return new Response(
      JSON.stringify({ error: { message: 'Method not allowed', type: 'api_error', code: 405 } }),
      { status: 405, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
    );

  const model = {
    // ── Core identity ──
    id:                          'voidv1-flash',
    object:                      'model',
    created:                     1700000000,
    owned_by:                    'void',
    name:                        'Void V1 Flash',
    display_name:                'Void V1 Flash',
    description:                 'Advanced high-reasoning model optimized for coding, planning, and complex agent workflows with up to 1M token context and configurable reasoning effort.',

    // ── Type ──
    type:                        'chat',

    // ── Context & limits ──
    context_length:              1000000,
    context_window:              1000000,
    max_output_tokens:           32000,
    max_completion_tokens:       32000,
    max_tokens:                  32000,

    // ── Reasoning flags (top-level, all formats tools check) ──
    // reasoning_effort_default: tools surface a difficulty picker with this pre-selected
    reasoning_effort_default:    'medium',
    // forceReasoning: ai-sdk/openai flag — treats this as a reasoning model even with unknown ID
    forceReasoning:              true,
    // Anthropic-style thinking flags (Claude Code + tools that check these)
    thinking:                    true,
    supports_thinking:           true,
    reasoning:                   true,
    reasoning_effort:            true,
    supports_reasoning_effort:   true,
    reasoning_effort_levels:     REASONING_EFFORT_LEVELS,
    // OpenAI o-series style
    supports_reasoning:          true,
    has_reasoning:               true,

    // ── OpenRouter-style top_provider (OpenCode Zen, Cursor, Windsurf read this) ──
    top_provider: {
      context_length:            1000000,
      max_completion_tokens:     32000,
      reasoning:                 true,
      reasoning_effort:          true,
      reasoning_effort_levels:   REASONING_EFFORT_LEVELS,
      supports_reasoning_effort: true,
      reasoning_effort_default:  'medium',
      forceReasoning:            true,
      thinking:                  true,
      is_moderated:              false,
    },

    // ── Capabilities (Claude Code, OpenCode, Windsurf check this object) ──
    capabilities: {
      reasoning:                 true,
      reasoning_effort:          true,
      supports_reasoning_effort: true,
      reasoning_effort_levels:   REASONING_EFFORT_LEVELS,
      reasoning_effort_default:  'medium',
      thinking:                  true,
      supports_thinking:         true,
      tools:                     true,
      tool_choice:               true,
      streaming:                 true,
      response_format:           true,
      function_calling:          true,
      parallel_tool_calls:       true,
      vision:                    false,
      image_generation:          false,
    },

    // ── Architecture (OpenRouter format) ──
    architecture: {
      modality:                  'text->text',
      tokenizer:                 'Other',
      instruct_type:             'none',
    },

    // ── Pricing (free) ──
    pricing: {
      prompt:                    '0',
      completion:                '0',
      image:                     '0',
      request:                   '0',
    },

    // ── Metadata (string format — some tools parse string fields) ──
    metadata: {
      reasoning:                 'true',
      reasoning_effort:          'true',
      supports_reasoning_effort: 'true',
      reasoning_effort_levels:   REASONING_EFFORT_LEVELS.join(','),
      reasoning_effort_default:  'medium',
      thinking:                  'true',
    },

    // ── supported_parameters (OpenRouter/OpenCode/Codex read this to show reasoning effort picker) ──
    supported_parameters: [
      'reasoning_effort',
      'reasoning',
      'stream',
      'temperature',
      'max_tokens',
      'tools',
      'tool_choice',
    ],

    per_request_limits:          null,
  };

  return new Response(JSON.stringify({
    object: 'list',
    data: [model],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
