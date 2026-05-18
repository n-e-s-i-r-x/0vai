export const config = { runtime: 'edge' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, api-key, x-api-key',
};

const REASONING_EFFORT_LEVELS = ['default', 'low', 'medium', 'high', 'extrahigh', 'max'];

export default function handler(req) {
  if (req.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: CORS_HEADERS });

  if (req.method !== 'GET')
    return new Response(
      JSON.stringify({ error: { message: 'Method not allowed', type: 'api_error', code: 405 } }),
      { status: 405, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
    );

  const model = {
    id:                          'voidv1-flash',
    object:                      'model',
    created:                     1700000000,
    owned_by:                    'void',
    name:                        'Void V1 Flash',
    description:                 'Advanced high-reasoning mode of Void V1 Flash featuring 1 trillion total parameters with 50B active parameters, optimized for deeper thinking, coding, planning, and complex agent workflows with up to 1M token context.',

    // ── Context & limits ──
    context_length:              1000000,
    max_output_tokens:           32000,
    max_completion_tokens:       32000,

    // ── Top-level reasoning flags ──
    reasoning:                   true,
    reasoning_effort:            true,
    supports_reasoning_effort:   true,
    reasoning_effort_levels:     REASONING_EFFORT_LEVELS,

    // ── OpenRouter-style top_provider (critical for tool detection) ──
    top_provider: {
      context_length:            1000000,
      max_completion_tokens:     32000,
      reasoning:                 true,
      reasoning_effort:          true,
      reasoning_effort_levels:   REASONING_EFFORT_LEVELS,
    },

    // ── Capabilities ──
    capabilities: {
      reasoning:                 true,
      reasoning_effort:          true,
      tools:                     true,
      streaming:                 true,
      response_format:           true,
      function_calling:          true,
      vision:                    false,
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

    // ── Metadata (string format) ──
    metadata: {
      reasoning:                 'true',
      reasoning_effort:          'true',
      reasoning_effort_levels:   REASONING_EFFORT_LEVELS.join(','),
    },

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
