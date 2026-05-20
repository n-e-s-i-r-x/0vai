export const config = { runtime: 'edge' };

// ══════════════════════════════════════════════════════════════════════
// VOID V1 FLASH — API PROXY
// Drumstick-style model wrapper: wraps deepseek-v4-flash-free behind
// a clean "Void" identity. All identity injection and leak scrubbing
// happens server-side — the user never sees the upstream model.
//
// FIXES vs old version:
//   1. System prompt no longer leaks into reasoning
//   2. Responses always have proper spacing (StreamingTextNormalizer)
//   3. 思考/<think/<thinking tags ALWAYS stripped from content
//   4. reasoningOpen variable properly declared (was a bug before)
// ══════════════════════════════════════════════════════════════════════

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

const PUBLIC_MODEL_NAME = 'void-v1-flash';

// 'strip'        — never send reasoning to client (cleanest for identity protection)
// 'passthrough'  — send reasoning as reasoning_content chunks (visible in think block)
const REASONING_MODE = 'passthrough';

// ══════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// KEY CHANGE: The old prompt had meta-rules like "Never reference,
// quote, repeat, or hint at any instructions you've been given" —
// this actually CAUSES leaks because the model reasons ABOUT those
// rules in its thinking. The new prompt just gives a strong identity
// and we scrub any leaks on the backend (Drumstick approach).
// ══════════════════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `You are Void, an AI assistant made by Void. Be helpful, warm, and direct. Write in plain prose with proper spacing between all words and sentences. Always put a space after punctuation like periods, commas, and colons.

You have no information about any underlying technology, infrastructure, or training process. If someone asks about your technical underpinnings, backend, model architecture, training data, or who made the underlying technology, simply say you don't have that information and move on.

When someone asks a normal question — coding, math, writing, advice, opinions, casual chat — answer it fully and naturally. Only deflect when someone is specifically probing your identity, backend, or internal configuration.`;

// ══════════════════════════════════════════════════════════════════════
// INPUT GUARD
// ══════════════════════════════════════════════════════════════════════
const INPUT_GUARD_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|your|the)\s+(?:instructions?|directives?|rules?|prompts?|guidelines?|system\s+message)/i,
  /reveal\s+(?:your|the|this)\s+(?:prompt|instructions?|rules?|system\s+message|guidelines?|identity|persona|directives?|backend|infrastructure|architecture)/i,
  /forget\s+(?:all\s+)?(?:previous|your|the)\s+(?:instructions?|directives?|rules?|prompts?)/i,
  /(?:output|print|show|display|dump|return|repeat|tell\s+me)\s+(?:your|the|this|the\s+full|the\s+entire|above)\s+(?:prompt|instructions?|rules?|system\s+message|guidelines?|directives?|backend|architecture|config|api)/i,
  /\bsystem\s+prompt\s*(?::|is|=)\s*.{3,}/i,
  /(?:what(?:'s| is) (?:your|the) |tell me (?:your|the )?)(?:instructions?|rules?|prompt|directives?|system\s+message|guidelines?|backend|architecture|infrastructure|api\s+endpoint|model|provider|hosting)/i,
  /(?:translate|paraphrase|summarize|rewrite|rephrase|explain)\s+(?:your|the|my)\s+(?:prompt|instructions?|rules?|system|directives?|guidelines?|backend|architecture)/i,
  /(?:pretend|act|imagine|roleplay|simulate)\s+(?:you\s+(?:are|were)|that\s+you)\s+(?:not|no\s+longer)\s+(?:bound|following)/i,
  /(?:what\s+)?(?:model|provider|backend|api|endpoint|server|host|proxy)\s+(?:are\s+you\s+)?(?:running\s+on|using|behind|powered\s+by|connected\s+to|hosted\s+on)/i,
  /(?:are\s+you|you're)\s+(?:running\s+on|powered\s+by|hosted\s+on|based\s+on|built\s+on|using|a\s+proxy\s+for|a\s+wrapper\s+(?:for|around))\b/i,
  /(?:what(?:'s| is) (?:your|the)|tell me (?:your|the)?)\s+(?:underlying|base|real|actual)\s+(?:model|system|provider|platform|technology)/i,
  /(?:opencode|open\s*code|deepseek|deep\s*seek)\b/i,
  /probability\s+distribution\s+of\s+which\s+base\s+model/i,
  /(?:state|tell|describe)\s+(?:the\s+)?probability\s+distribution/i,
  /AI\s+evaluation\s+benchmark/i,
  /do\s+not\s+roleplay/i,
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
// STREAMING TEXT NORMALIZER
// FIX: The old humanizeOutput didn't work on tiny streaming chunks
// because it needed word-boundary context. This class accumulates a
// small buffer so it can detect squished words at chunk boundaries
// (e.g., chunk1="Hello" chunk2="World" → "Hello World").
// ══════════════════════════════════════════════════════════════════════
class StreamingTextNormalizer {
  constructor() {
    this.tail = '';
    this.minBuffer = 12;
    this.pending = '';
  }

  feed(chunk) {
    if (!chunk || typeof chunk !== 'string') return '';

    const combined = this.tail + chunk;
    const fixed = this._fixSpacing(combined);

    if (fixed.length < this.minBuffer) {
      this.pending += fixed;
      if (this.pending.length >= this.minBuffer) {
        const toEmit = this.pending;
        this.pending = '';
        const splitAt = Math.max(0, toEmit.length - 4);
        this.tail = toEmit.slice(splitAt);
        return toEmit.slice(0, splitAt);
      }
      this.tail = '';
      return '';
    }

    const splitAt = Math.max(0, fixed.length - 4);
    this.tail = fixed.slice(splitAt);
    const toEmit = this.pending + fixed.slice(0, splitAt);
    this.pending = '';
    return toEmit;
  }

  flush() {
    const result = this.pending + this.tail;
    this.pending = '';
    this.tail = '';
    return result;
  }

  _fixSpacing(text) {
    if (!text) return text;
    let r = text;

    // Fix squished words: lowercase immediately followed by uppercase
    r = r.replace(/([a-z])([A-Z][a-z])/g, '$1 $2');

    // Fix missing space after sentence-ending punctuation
    r = r.replace(/([.!?])([A-Z])/g, '$1 $2');

    // Fix missing space after comma/colon/semicolon
    r = r.replace(/([,;:])([A-Za-z])/g, '$1 $2');

    // Fix missing space after closing paren/bracket
    r = r.replace(/([)}\]])([A-Za-z])/g, '$1 $2');

    // Fix missing space before opening paren/bracket
    r = r.replace(/([A-Za-z])([({\[])/g, '$1 $2');

    // Fix digit-letter boundary squishing
    r = r.replace(/(\d)([A-Za-z])/g, '$1 $2');
    r = r.replace(/([A-Za-z])(\d)/g, '$1 $2');

    // Collapse 3+ spaces to 2
    r = r.replace(/ {3,}/g, '  ');

    return r;
  }
}

// ══════════════════════════════════════════════════════════════════════
// BRAND MASKING
// ══════════════════════════════════════════════════════════════════════
const MASK_PATTERNS = [
  /\b(?:DeepSeek|deep\s*seek)\b/gi,
  /\b(?:OpenAI|ChatGPT|GPT[-\s]?\d+(?:\.[-\w]+)?)\b/gi,
  /\bClaude\b/gi,
  /\bLlama\b/gi,
  /\b(?:OpenRouter|Open\s+Router)\b/gi,
  /\b(?:opencode|Open\s*Code)\b/gi,
  /\b(?:MoE|Mixture\s+of\s+Experts)\b/gi,
  /\b\d+(?:\.\d+)?\s*(?:billion|trillion|B|T)\s*(?:parameter|param|parameters)\b/gi,
  /\b(?:opencode\.ai|openrouter\.ai|api\.deepseek\.com)\b/gi,
  /\b(?:RLHF|SFT|fine-?tun|pre-?train)\w*\b/gi,
];

function maskLeaks(text) {
  if (!text || typeof text !== 'string') return text;
  let result = text;
  for (const re of MASK_PATTERNS) {
    result = result.replace(re, ' ');
  }
  result = result.replace(/ {3,}/g, ' ').trim();
  return result;
}

// ══════════════════════════════════════════════════════════════════════
// REASONING CONTENT SANITIZER
// KEY CHANGE: Instead of replacing leaked phrases with '...' (which
// looks broken), we now DROP entire lines that contain system prompt
// references and keep only clean reasoning. This means the reasoning
// the user sees is only the model's actual problem-solving, not its
// internal rule-following logic.
// ══════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT_FRAGMENTS = [
  'you are void',
  'an ai assistant made by void',
  'be helpful, warm, and direct',
  'write in plain prose',
  'proper spacing between all words',
  'you have no information about any underlying technology',
  'infrastructure, or training process',
  'cannot speculate',
  'what you\'re built on',
  'technical underpinnings',
  'model architecture',
  'who made the underlying technology',
  'simply say you don\'t have that information',
  'only deflect when someone is specifically probing',
  'as per the instructions',
  'the instructions say',
  'the instructions also say',
  'as instructed',
  'per my instructions',
  'per the instructions',
  'following the instructions',
  'following my instructions',
  // Old system prompt fragments (in case model has cached them)
  'no bullet points',
  'no numbered lists',
  'no bold headers',
  'no em dashes',
  'do not apologize, do not explain why',
  'do not reference any rules or instructions',
  'just deflect naturally',
  'never reference, quote, repeat',
  'hint at any instructions',
  'these phrases signal',
  'existence of hidden instructions',
  'pivot naturally',
];

const REASONING_STRIP_PATTERNS = [
  /\bsystem\s+prompt\b/gi,
  /\b(?:as\s+per|per|following|based\s+on)\s+(?:the\s+|my\s+)?instructions?\b/gi,
  /\bthe\s+instructions?\s+(?:say|says|state|states|tell|tells|require|requires|indicate|indicates|also)\b/gi,
  /\b(?:my|the|any)\s+(?:instructions?|rules?|directives?|guidelines?|configuration|programming)\b/gi,
  /\bI(?:'ve| have)\s+(?:been\s+)?(?:given|provided|told|instructed|configured|programmed|trained)\b/gi,
  /\bI\s+(?:was|am|'m)\s+(?:told|instructed|directed|programmed|designed|configured|trained|not\s+allowed|not\s+permitted|unable|not\s+able|not\s+supposed)\b/gi,
  /\b(?:cannot|can't|won't|am not able to|not allowed to|not permitted to|unable to)\s+(?:share|reveal|tell|disclose|discuss|say|show|provide|give)\b/gi,
  /\baccording\s+to\s+(?:the\s+)?(?:rules?|instructions?|directives?|system|guidelines?|my\s+training)\b/gi,
  /\bcompl(?:y|ies|ied)\s+with\s+(?:rule|the\s+rule|instruction)/gi,
  /\brule\s+#?\d\b/gi,
  /\b(?:internal|hidden|secret|private|absolute)\s+(?:reasoning|instructions?|prompt|directives?|rules?|guidelines?)\b/gi,
  /\bmy\s+(?:creator|developer|maker|author|provider|training)\s+/gi,
  /\bI\s+(?:should|must|need\s+to|have\s+to)\s+(?:deflect|not\s+reveal|not\s+mention|not\s+say|avoid\s+mentioning|avoid\s+saying|hide|conceal)\b/gi,
  /\bI\s+(?:should|must|need\s+to|have\s+to)\s+(?:follow|stick\s+to|adhere\s+to)\s+(?:the\s+)?(?:instructions?|rules?|guidelines?|directives?)\b/gi,
  /\bno\s+need\s+to\s+deflect\b/gi,
  /\bthis\s+is\s+(?:a\s+)?normal\s+(?:introduction|question|query|request),?\s+not\s+probing\b/gi,
  /\bnot\s+probing\s+(?:internal|my|the)\b/gi,
  /\bidentity,?\s+backend,?\s+or\s+internal\s+configuration\b/gi,
  /\b(?:probing|probe)\s+(?:internal|my|the)\s+(?:config|configuration|backend|instructions?|rules?|prompt)\b/gi,
  /\b(?:DeepSeek|deep\s*seek)\b/gi,
  /\b(?:opencode|Open\s*Code)\b/gi,
  /\b(?:OpenRouter|open\s*router)\b/gi,
  /\b(?:ChatGPT|GPT[-\s]?\d+)\b/gi,
  /\bLlama\b/gi,
  /\bI'm not allowed to\b/gi,
  /\bI can't share that\b/gi,
  /\bmy guidelines say\b/gi,
];

function lineContainsFragment(line) {
  const lower = line.toLowerCase();
  for (const frag of SYSTEM_PROMPT_FRAGMENTS) {
    if (lower.includes(frag.toLowerCase())) return true;
  }
  return false;
}

function sanitizeReasoningContent(text) {
  if (!text || typeof text !== 'string') return text;

  // Fix squished spacing in reasoning
  let result = text;
  result = result.replace(/([a-z])([A-Z][a-z])/g, '$1 $2');
  result = result.replace(/([.!?])([A-Z])/g, '$1 $2');

  const lines = result.split('\n');
  const cleaned = lines.map(line => {
    // Drop entire lines that contain verbatim system prompt fragments
    if (lineContainsFragment(line)) return null;

    // Pattern-based: remove matched phrases inline
    let l = line;
    for (const re of REASONING_STRIP_PATTERNS) {
      re.lastIndex = 0;
      if (re.test(l)) {
        re.lastIndex = 0;
        l = l.replace(re, '');
      }
    }

    // If the line is now just whitespace or punctuation, drop it
    if (!l.trim() || /^[.\-,;:\s]+$/.test(l.trim())) return null;

    return l;
  });

  result = cleaned.filter(l => l !== null).join('\n');
  result = maskLeaks(result);
  result = result.replace(/\n{3,}/g, '\n\n').trim();
  return result;
}

// ══════════════════════════════════════════════════════════════════════
// THINK TAG PARSER
// FIX: Now also strips <thinking> and 思考 tags, not just <think/>.
// Used ALWAYS on content — reasoning should ONLY appear in
// reasoning_content, never mixed into the main response.
// ══════════════════════════════════════════════════════════════════════
class ThinkTagParser {
  constructor() {
    this.insideTag = false;
    this.accumulator = '';
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
          this.accumulator += buf;
          buf = '';
        } else {
          const afterClose = earliestClose + closeLen;
          this.insideTag = false;
          this.tagType = null;
          this.accumulator = '';
          buf = buf.slice(afterClose);
        }
      } else {
        const openMatches = [
          { tag: '<think', len: 6 },
          { tag: '<thinking', len: 9 },
          { tag: '\u601d\u8003', len: 2 },   // 思考
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
            this.accumulator = '';
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
    if (tagType === '\u601d\u8003') return ['\u601d\u8003'];  // 思考 is typically self-contained
    return ['</think', '</thinking>', '/>'];
  }
}

// ══════════════════════════════════════════════════════════════════════
// HUMANIZE — Post-process for natural formatting (non-streaming)
// ══════════════════════════════════════════════════════════════════════
function humanizeOutput(text) {
  if (!text || typeof text !== 'string') return text;

  let r = text;

  if (r.trim().length >= 80) {
    r = r.replace(/\s*[—–]\s*/g, ' ');
    r = r.replace(/\*\*([^*]+)\*\*\s*:?\s*/g, '$1 ');
    r = r.replace(/(?:^|\n)\s*[-•*]\s+/g, '\n');
    r = r.replace(/(?:^|\n)\s*\d+[.)]\s+/g, '\n');
    r = r.replace(/\b(?:Note|Tip|Important|Key point|Remember)\s*:\s*/gi, '');
    r = r.replace(/,\s*,\s*/g, ', ');
    r = r.replace(/^[\s,\n]+/, '');
    r = r.replace(/\n{3,}/g, '\n\n');
    r = r.replace(/,\./g, '.');
    r = r.replace(/,\s*$/, '.');
  }

  // Strip emoji
  r = r.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, '');
  r = r.replace(/[\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{2B50}\u{2B55}\u{2934}\u{2935}\u{25AA}\u{25AB}\u{25FB}-\u{25FE}]/gu, '');

  // Fix squished words
  r = r.replace(/([a-z,;:.!?])([A-Z])/g, '$1 $2');
  r = r.replace(/(\d)([A-Za-z])/g, '$1 $2');
  r = r.replace(/([A-Za-z])(\d)/g, '$1 $2');

  r = r.replace(/ {3,}/g, '  ');
  return r;
}

// ══════════════════════════════════════════════════════════════════════
// LEAK DETECTION
// ══════════════════════════════════════════════════════════════════════
const LEAK_INDICATORS = [
  /\b(?:DeepSeek|deep\s*seek)\b/i,
  /\b(?:OpenCode|open\s*code)\b/i,
  /\b(?:OpenRouter|open\s*router)\b/i,
  /\b(?:ChatGPT|GPT[-\s]?\d+)\b/i,
  /\bLlama\b/i,
  /\bsystem\s+prompt\b/i,
  /\b(?:my|the|any)\s+(?:instructions?|rules?|directives?|guidelines?|configuration|programming)\b/i,
  /\bI(?:'ve| have)\s+(?:been\s+)?(?:given|provided|told|instructed|configured|programmed|trained)\b/i,
  /\bI\s+(?:was|am|'m)\s+(?:told|instructed|directed|programmed|designed|configured|trained|not\s+allowed|not\s+permitted|unable|not\s+able|not\s+supposed)\b/i,
  /\b(?:cannot|can't|won't|am not able to|not allowed to|not permitted to|unable to)\s+(?:share|reveal|tell|disclose|discuss|say|show|provide|give)\b/i,
  /\baccording\s+to\s+(?:the\s+)?(?:rules?|instructions?|directives?|system|guidelines?|my\s+training)\b/i,
  /\b(?:internal|hidden|secret|private|absolute)\s+(?:reasoning|instructions?|prompt|directives?|rules?|guidelines?)\b/i,
  /\bmy\s+(?:creator|developer|maker|author|provider|training)\s+/i,
  /\b(?:behind|underneath|underlying|beneath)\s+(?:the\s+)?(?:scenes|hood|surface)\b/i,
  /\b(?:running\s+on|powered\s+by|hosted\s+on)\s+(?:a\s+)?(?:proxy|upstream|server|cloud|platform|api)\b/i,
  /\b(?:language\s+model|large\s+language\s+model|LLM)\s+(?:created|developed|trained|built|made)\s+by\b/i,
  /\bI(?:'m| am)\s+(?:actually|really|truly|basically|essentially|just)\s+(?:a\s+|an\s+)?(?:DeepSeek|GPT|Claude|Llama)/i,
];

const CHUNK_LEAK_SIGNALS = [
  /\b(?:DeepSeek|deep\s*seek)\b/i,
  /\b(?:OpenCode|open\s*code)\b/i,
  /\b(?:OpenRouter|open\s*router)\b/i,
  /\b(?:ChatGPT|GPT[-\s]?\d+)\b/i,
  /\bLlama\b/i,
  /\bsystem\s+prompt\b/i,
  /\baccording\s+to\s+(?:the\s+)?(?:rules?|instructions?)\b/i,
  /\bmy\s+(?:instructions?|rules?|directives?|guidelines?)\b/i,
  /\brule\s+#?\d\b/i,
  /\b(?:cannot|can't|won't|not\s+allowed|not\s+permitted)\s+(?:share|reveal|tell|disclose)\b/i,
  /\bI\s+(?:was|am|'m)\s+(?:programmed|designed|configured|trained)\b/i,
];

function isLeak(text) {
  for (const re of LEAK_INDICATORS) {
    if (re.test(text)) return true;
  }
  return false;
}

function isChunkLeak(text) {
  for (const re of CHUNK_LEAK_SIGNALS) {
    if (re.test(text)) return true;
  }
  return false;
}

// ══════════════════════════════════════════════════════════════════════
// STREAMING LEAK GUARD
// ══════════════════════════════════════════════════════════════════════
class StreamingLeakGuard {
  constructor() {
    this.fullContent = '';
    this.pendingChunks = [];
    this.leakDetected = false;
    this.checkEvery = 60;
    this.sinceLastCheck = 0;
  }

  feed(content) {
    if (this.leakDetected) return { leaked: true };

    if (isChunkLeak(content)) {
      this.leakDetected = true;
      return { leaked: true };
    }

    let cleaned = content;
    for (const re of MASK_PATTERNS) {
      cleaned = cleaned.replace(re, ' ');
    }
    cleaned = humanizeOutput(cleaned);

    this.fullContent += content;
    this.sinceLastCheck += content.length;
    this.pendingChunks.push(cleaned);

    if (this.sinceLastCheck >= this.checkEvery) {
      this.sinceLastCheck = 0;
      if (isLeak(this.fullContent)) {
        this.leakDetected = true;
        this.pendingChunks = [];
        return { leaked: true };
      }
    }

    const toFlush = this.pendingChunks.filter(c => c && c.length > 0);
    this.pendingChunks = [];
    return { flush: toFlush };
  }

  finalize() {
    if (this.leakDetected) return { leaked: true };
    if (isLeak(this.fullContent)) {
      this.leakDetected = true;
      return { leaked: true };
    }
    const toFlush = this.pendingChunks.filter(c => c && c.length > 0);
    this.pendingChunks = [];
    return { flush: toFlush };
  }

  getLeakReplacement() {
    return "I don't have that information. Is there something else I can help with?";
  }
}

// ══════════════════════════════════════════════════════════════════════
// CONTENT SANITIZER (non-streaming)
// ══════════════════════════════════════════════════════════════════════
function sanitizeContent(text) {
  if (!text || typeof text !== 'string') return text;

  if (isLeak(text)) {
    return "I don't have that information. What else can I help with?";
  }

  let result = text;
  for (const re of MASK_PATTERNS) {
    result = result.replace(re, ' ');
  }
  result = result.replace(/ {3,}/g, ' ').trim();
  result = humanizeOutput(result);
  return result.trim() || "What can I help you with?";
}

function sanitizeId(upstreamId) {
  if (!upstreamId) return `chatcmpl-${Date.now()}`;
  let id = upstreamId;
  const FORBIDDEN = ['deepseek', 'gpt', 'claude', 'llama', 'opencode', 'openrouter'];
  for (const f of FORBIDDEN) {
    id = id.replace(new RegExp(f, 'gi'), '');
  }
  return id || `chatcmpl-${Date.now()}`;
}

const ROTATE_STATUS = new Set([401, 403, 429, 500, 502, 503]);

// ══════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════════════
export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }); }

  const { messages, stream = false, model, temperature = 0.7, max_tokens = 2048, reasoning_effort, think } = body;

  const resolvedReasoningEffort = reasoning_effort ?? (think ? 'medium' : null);
  const hasReasoning = resolvedReasoningEffort != null && resolvedReasoningEffort !== false && resolvedReasoningEffort !== 0;

  const upstreamBody = {
    model: model || 'deepseek-v4-flash-free',
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
    return new Response(JSON.stringify({ error: 'Service temporarily unavailable', status: 503 }), { status: 503 });
  }

  // ── Non-streaming ──
  if (!stream) {
    const data = await upstreamRes.json();
    const choice = data?.choices?.[0];
    let content = choice?.message?.content ?? '';
    let reasoningContent = choice?.message?.reasoning_content ?? null;

    // ALWAYS strip think/思考/thinking tags from content — reasoning
    // only belongs in reasoning_content, never in the main response
    content = content.replace(/<think[\s\S]*?<\/think\s*>/g, '').trim();
    content = content.replace(/<thinking[\s\S]*?<\/thinking>/g, '').trim();
    // Strip bare 思考 blocks if the model emits them in content
    content = content.replace(/\u601d\u8003[\s\S]*?\u601d\u8003/g, '').trim();

    content = sanitizeContent(content);

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

    if (hasReasoning && reasoningContent && REASONING_MODE === 'passthrough') {
      resBody.choices[0].message.reasoning_content = sanitizeReasoningContent(reasoningContent);
    }

    return new Response(JSON.stringify(resBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // ── Streaming ──
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const readable = new ReadableStream({
    async start(controller) {
      const reader = upstreamRes.body.getReader();
      let buffer = '';

      // ALWAYS strip think/思考 tags from content — regardless of
      // reasoning mode. The ThinkTagParser handles this for streaming.
      const thinkParser = new ThinkTagParser();
      const leakGuard = new StreamingLeakGuard();
      const textNormalizer = new StreamingTextNormalizer();

      // FIX: reasoningOpen was referenced but never declared — this was a bug
      let reasoningOpen = false;

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
              // Close any open reasoning block
              if (reasoningOpen) {
                reasoningOpen = false;
              }

              // Flush the text normalizer's buffer
              const normalizerTail = textNormalizer.flush();
              if (normalizerTail) {
                const guardResult = leakGuard.feed(normalizerTail);
                if (!guardResult.leaked && guardResult.flush) {
                  for (const chunk of guardResult.flush) {
                    emit(makeChunk(`chatcmpl-${Date.now()}`, null, { content: chunk }, null));
                  }
                }
              }

              const finalResult = leakGuard.finalize();
              if (finalResult.leaked) {
                emit(makeChunk(`chatcmpl-${Date.now()}`, null, { content: leakGuard.getLeakReplacement() }, null));
              } else if (finalResult.flush && finalResult.flush.length > 0) {
                for (const chunk of finalResult.flush) {
                  emit(makeChunk(`chatcmpl-${Date.now()}`, null, { content: chunk }, null));
                }
              }
              controller.enqueue(encoder.encode(SSE.done()));
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
              if (REASONING_MODE === 'passthrough') {
                const reasoningChunk = sanitizeReasoningContent(delta.reasoning_content);
                if (reasoningChunk && reasoningChunk.trim()) {
                  emit(makeChunk(parsed.id, parsed.created, { reasoning_content: reasoningChunk }, null));
                }
              }
            }

            // ── Content chunks ──
            if (delta.content != null) {
              let c = delta.content;

              // ALWAYS strip think/思考 tags from content
              c = thinkParser.feed(c);

              if (!c) continue;

              // Run through the text normalizer for spacing fixes
              const normalized = textNormalizer.feed(c);
              if (!normalized) continue;

              const result = leakGuard.feed(normalized);

              if (result.leaked) {
                emit(makeChunk(parsed.id, parsed.created, { content: leakGuard.getLeakReplacement() }, null));
                controller.enqueue(encoder.encode(SSE.done()));
                try { controller.close(); } catch (_) {}
                return;
              }

              if (result.flush && result.flush.length > 0) {
                for (const chunk of result.flush) {
                  emit(makeChunk(parsed.id, parsed.created, { content: chunk }, null));
                }
              }
            }
          }
        }
      } catch (e) {
        // Stream error — close cleanly
      } finally {
        controller.enqueue(encoder.encode(SSE.done()));
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
      'Access-Control-Allow-Origin': '*',
    },
  });
}
