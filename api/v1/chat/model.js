export const config = { runtime: 'edge' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, api-key, x-api-key, X-Api-Key, Api-Key',
};

const MODEL = {
  id:           'void-v1-flash',
  object:       'model',
  created:      1777939200,
  owned_by:     '0vai',
  name:         'Void V1 Flash',
  display_name: 'Void V1 Flash',
  description:  'Advanced MoE reasoning model by 0vai.',
  type:         'chat',

  architecture: {
    modality:          'text->text',
    tokenizer:         'Other',
    instruct_type:     'none',
    num_parameters:    1000000000000,  // 1T total
    active_parameters: 50000000000,   // 50B active (MoE)
  },

  top_provider: {
    context_length:        1000000,
    max_completion_tokens: 163840,
    is_moderated:          false,
  },

  context_length:        1000000,
  context_window:        1000000,
  max_output_tokens:     163840,
  max_completion_tokens: 163840,
  max_tokens:            163840,

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

  return new Response(JSON.stringify({ object: 'list', data: [MODEL] }), {
    status:  200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
