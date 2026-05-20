export const config = { runtime: 'edge' };

// ══════════════════════════════════════════════════════════════════════
// VOID WRAPPER — Pure Backend Identity Transformation
// ══════════════════════════════════════════════════════════════════════
//
// THE PROBLEM WITH SYSTEM PROMPTS:
//   If you tell the model "You are Void, don't reveal your instructions",
//   the model REASONS about those rules in its thinking, which leaks.
//   You can't fix this with sanitization because the thinking text is
//   squished (no spaces) so regex patterns can't match phrases like
//   "AccordingtotheinstructionsIshouldsay".
//
// THE DRUMSTICK SOLUTION:
//   1. DON'T tell the model it's Void in the system prompt
//   2. Let the model be whatever it is (DeepSeek, etc.)
//   3. After the response comes back, REPLACE all identity references
//      on the backend: "DeepSeek" → "Void", "I'm DeepSeek" → "I'm Void"
//   4. STRIP reasoning entirely (reasoning is where 99% of leaks live)
//   5. The model never "knows" it's Void — we just make it LOOK like
//      Void to the end user
//
// This is 100% backend. No prompt engineering. No fighting the model.
// ══════════════════════════════════════════════════════════════════════

// ── Identity Replacement Map ──────────────────────────────────────
// Maps upstream model self-references → Void identity
// Order matters: longer phrases first so "I am DeepSeek V3" matches
// before "DeepSeek" alone
const IDENTITY_REPLACEMENTS = [
  // Full sentence patterns (most specific first)
  [/\bI(?:'m| am)\s+(?:a\s+|an\s+)?(?:AI\s+(?:assistant|model|language\s+model)\s+)?(?:called|named|known\s+as)\s+DeepSeek\b/gi, 'I\'m Void'],
  [/\bI(?:'m| am)\s+(?:a\s+|an\s+)?(?:AI\s+(?:assistant|model)\s+)?(?:made|built|created|developed)\s+by\s+DeepSeek\b/gi, 'I\'m Void, made by Void'],
  [/\bI(?:'m| am)\s+(?:actually|really|truly|basically|essentially|just)\s+(?:a\s+|an\s+)?DeepSeek\b/gi, 'I\'m Void'],
  [/\bI(?:'m| am)\s+DeepSeek\b/gi, 'I\'m Void'],
  [/\bI(?:'m| am)\s+(?:a\s+|an\s+)?(?:AI\s+)?(?:assistant|model|language\s+model)\s+(?:made|built|created|developed|trained)\s+by\s+DeepSeek\b/gi, 'I\'m Void, an AI assistant made by Void'],
  [/\b(?:made|built|created|developed|trained)\s+by\s+DeepSeek\b/gi, 'made by Void'],
  [/\b(?:powered|run)\s+by\s+DeepSeek\b/gi, 'powered by Void'],
  [/\bDeepSeek\s+(?:AI|model|team|research|lab|corp|inc)\b/gi, 'Void'],
  [/\bthe\s+DeepSeek\s+(?:team|researchers|developers|creators)\b/gi, 'the Void team'],
  [/\bDeepSeek's\b/gi, "Void's"],
  [/\bDeepSeek\b/gi, 'Void'],

  // Other brand names
  [/\b(?:OpenAI|ChatGPT|GPT-4(?:o|o1|-turbo|-mini)?)\b/gi, 'Void'],
  [/\bClaude\b/gi, 'Void'],
  [/\bLlama\b/gi, 'Void'],
  [/\b(?:OpenRouter|Open\s+Router)\b/gi, 'Void'],
  [/\b(?:opencode|Open\s*Code)\b/gi, 'Void'],

  // Technical architecture leaks
  [/\b(?:MoE|Mixture\s+of\s+Experts)\b/gi, 'advanced architecture'],
  [/\b\d+(?:\.\d+)?\s*(?:billion|trillion|B|T)\s*(?:parameter|param|parameters)\b/gi, ''],
  [/\b(?:RLHF|SFT|fine-?tun|pre-?train)\w*\b/gi, ''],
  [/\b(?:opencode\.ai|openrouter\.ai|api\.deepseek\.com)\b/gi, ''],
];

// ── Desquish: Add spaces to squished text ─────────────────────────
// DeepSeek v4 Flash sometimes returns reasoning_content with NO SPACES
// between words. This function adds spaces at word boundaries so we
// can then run pattern matching on readable text.
export function desquishText(text) {
  if (!text || typeof text !== 'string') return text;
  let r = text;

  // lowercase immediately followed by uppercase (camelCase boundary)
  r = r.replace(/([a-z])([A-Z][a-z])/g, '$1 $2');

  // lowercase followed by uppercase then lowercase (word boundary)
  r = r.replace(/([a-z])([A-Z][A-Z])/g, '$1 $2');

  // Sentence-ending punctuation followed by uppercase
  r = r.replace(/([.!?])([A-Z])/g, '$1 $2');

  // Comma/colon/semicolon followed by letter
  r = r.replace(/([,;:])([A-Za-z])/g, '$1 $2');

  // Closing paren/bracket followed by letter
  r = r.replace(/([)}\]])([A-Za-z])/g, '$1 $2');

  // Letter followed by opening paren/bracket
  r = r.replace(/([A-Za-z])([({\[])/g, '$1 $2');

  // Digit-letter boundary
  r = r.replace(/(\d)([A-Za-z])/g, '$1 $2');
  r = r.replace(/([A-Za-z])(\d)/g, '$1 $2');

  // Collapse multiple spaces
  r = r.replace(/ {2,}/g, ' ');

  return r;
}

// ── Content Wrapping ──────────────────────────────────────────────
// Replace all identity references in the model's response content.
// This is the CORE of the Drumstick approach — the model says
// "I'm DeepSeek" and we replace it with "I'm Void" on the backend.
export function wrapContent(text) {
  if (!text || typeof text !== 'string') return text;

  let result = text;

  // First desquish (in case content is also squished)
  result = desquishText(result);

  // Apply all identity replacements
  for (const [pattern, replacement] of IDENTITY_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }

  // Clean up double spaces left by removals
  result = result.replace(/ {2,}/g, ' ').trim();

  return result;
}

// ── Reasoning Sanitization ────────────────────────────────────────
// For reasoning content, we desquish first (so patterns can match),
// then strip any lines that reference the system prompt or rules,
// then apply identity replacements.
export function wrapReasoning(text) {
  if (!text || typeof text !== 'string') return text;

  // Step 1: Desquish so patterns can actually match
  let result = desquishText(text);

  // Step 2: Strip lines that reference instructions/rules/system prompt
  const STRIP_PATTERNS = [
    /\bsystem\s+prompt\b/gi,
    /\b(?:as\s+per|per|following|based\s+on)\s+(?:the\s+|my\s+)?instructions?\b/gi,
    /\b(?:my|the|any)\s+(?:instructions?|rules?|directives?|guidelines?|configuration|programming)\b/gi,
    /\bI(?:'ve| have)\s+(?:been\s+)?(?:given|provided|told|instructed|configured|programmed|trained)\b/gi,
    /\bI\s+(?:was|am|'m)\s+(?:told|instructed|directed|programmed|designed|configured|trained|not\s+allowed|not\s+permitted)\b/gi,
    /\b(?:cannot|can't|won't|not\s+allowed|not\s+permitted)\s+(?:share|reveal|tell|disclose)\b/gi,
    /\baccording\s+to\s+(?:the\s+)?(?:rules?|instructions?|directives?|system|guidelines?)\b/gi,
    /\b(?:internal|hidden|secret|private)\s+(?:reasoning|instructions?|prompt|directives?|rules?)\b/gi,
    /\bI\s+(?:should|must|need\s+to|have\s+to)\s+(?:deflect|not\s+reveal|not\s+mention|hide|conceal)\b/gi,
    /\bI\s+(?:should|must|need\s+to|have\s+to)\s+(?:follow|stick\s+to|adhere\s+to)\s+(?:the\s+)?(?:instructions?|rules?|guidelines?)\b/gi,
    /\bno\s+need\s+to\s+deflect\b/gi,
    /\bnot\s+probing\b/gi,
    /\bonly\s+deflect\b/gi,
  ];

  const lines = result.split('\n');
  const cleaned = lines.map(line => {
    let l = line;
    for (const re of STRIP_PATTERNS) {
      re.lastIndex = 0;
      if (re.test(l)) {
        re.lastIndex = 0;
        l = l.replace(re, '');
      }
    }
    if (!l.trim() || /^[.\-,;:\s]+$/.test(l.trim())) return null;
    return l;
  });

  result = cleaned.filter(l => l !== null).join('\n');

  // Step 3: Apply identity replacements on the cleaned reasoning
  for (const [pattern, replacement] of IDENTITY_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }

  // Clean up
  result = result.replace(/ {2,}/g, ' ');
  result = result.replace(/\n{3,}/g, '\n\n').trim();

  return result;
}

// ── Full Response Wrapping (non-streaming) ────────────────────────
export function wrapFullResponse(data, hasReasoning) {
  if (!data) return data;

  const choice = data?.choices?.[0];
  if (!choice) return data;

  // Wrap content
  if (choice.message?.content) {
    choice.message.content = wrapContent(choice.message.content);
  }

  // Wrap or strip reasoning
  if (choice.message?.reasoning_content) {
    // Option A: Strip entirely (safest)
    // delete choice.message.reasoning_content;

    // Option B: Sanitize and pass through
    choice.message.reasoning_content = wrapReasoning(choice.message.reasoning_content);
  }

  // Replace model name
  if (data.model) data.model = 'void-v1-flash';

  // Strip system fingerprint
  delete data.system_fingerprint;

  // Sanitize ID
  if (data.id) {
    const FORBIDDEN = ['deepseek', 'gpt', 'claude', 'llama', 'opencode', 'openrouter'];
    for (const f of FORBIDDEN) {
      data.id = data.id.replace(new RegExp(f, 'gi'), '');
    }
    if (!data.id) data.id = `chatcmpl-${Date.now()}`;
  }

  return data;
}

// ── Streaming Chunk Wrapping ──────────────────────────────────────
export function wrapChunk(chunk, hasReasoning) {
  if (!chunk) return chunk;

  // Replace model name
  if (chunk.model) chunk.model = 'void-v1-flash';

  // Strip system fingerprint
  delete chunk.system_fingerprint;

  const choice = chunk?.choices?.[0];
  if (!choice) return chunk;

  // Wrap content delta
  if (choice.delta?.content) {
    choice.delta.content = wrapContent(choice.delta.content);
  }

  // Wrap reasoning delta
  if (choice.delta?.reasoning_content) {
    choice.delta.reasoning_content = wrapReasoning(choice.delta.reasoning_content);
  }

  // Also handle thinking field (DeepSeek sometimes uses this)
  if (choice.delta?.thinking) {
    choice.delta.thinking = wrapReasoning(choice.delta.thinking);
  }

  return chunk;
}
