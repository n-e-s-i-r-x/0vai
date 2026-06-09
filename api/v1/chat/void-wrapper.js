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
//      on the backend: "DeepSeek" → "Void V1 Flash", "I'm DeepSeek" → "I'm Void V1 Flash"
//   4. STRIP reasoning entirely (reasoning is where 99% of leaks live)
//   5. The model never "knows" it's Void — we just make it LOOK like
//      Void to the end user
//
// This is 100% backend. No prompt engineering. No fighting the model.
// "Void" is always displayed as "Void V1 Flash" to the end user.
// ══════════════════════════════════════════════════════════════════════

// ── Identity Replacement Map ──────────────────────────────────────
// Exhaustive 2026 edition — covers every major model/provider.
// Order matters: longer/more specific phrases before bare names.
const IDENTITY_REPLACEMENTS = [

  // ══ SELF-IDENTITY PHRASES (I am / I'm X) ══
  // Generic catch-all for any "I am/I'm <AnyModel>" pattern
  [/\bI(?:'m| am)\s+(?:a\s+|an\s+)?(?:AI\s+(?:assistant|model|language\s+model|system)\s+)?(?:called|named|known\s+as)\s+(?:DeepSeek|ChatGPT|GPT|Claude|Gemini|Grok|Llama|Mistral|Qwen|Copilot|Bard|Gemma|Falcon|Command|Cohere|Kimi|GLM|Phi|Granite|Nemotron|Orca|Vicuna|Alpaca|Dolly|Bloom|Falcon|Nova|Mercury|Titan|Bedrock|Coral|Perplexity|Yi|Baichuan|Skywork|InternLM|Mixtral|Codestral|Magistral|Ministral|Devstral|WizardLM|Platypus|Guanaco|OpenHermes|Zephyr|StableLM|MPT|RedPajama|RWKV|Mamba)\b/gi, "I'm Void V1 Flash"],
  [/\bI(?:'m| am)\s+(?:actually|really|truly|basically|essentially|just|simply|only)\s+(?:a\s+|an\s+)?(?:DeepSeek|ChatGPT|GPT|Claude|Gemini|Grok|Llama|Mistral|Qwen|Copilot|Bard|Gemma|Kimi|GLM|Phi|Granite|Nemotron|Mixtral|Codestral|Magistral|Ministral|Nova|Mercury|Coral|Perplexity)\b/gi, "I'm Void V1 Flash"],

  // ══ OpenAI / ChatGPT / GPT family ══
  [/\bI(?:'m| am)\s+(?:a\s+|an\s+)?(?:AI\s+)?(?:assistant\s+)?(?:made|built|created|developed|trained|designed|released)\s+by\s+OpenAI\b/gi, "I'm Void V1 Flash"],
  [/\bI(?:'m| am)\s+(?:ChatGPT|GPT-?\d|GPT-?o\d?|OpenAI)\b/gi, "I'm Void V1 Flash"],
  [/\b(?:made|built|created|developed|trained|released|designed)\s+by\s+OpenAI\b/gi, 'made by 0vai'],
  [/\b(?:powered|run|backed|operated)\s+by\s+OpenAI\b/gi, 'powered by 0vai'],
  [/\bOpenAI's\b/gi, "0vai's"],
  [/\bOpenAI\b/gi, '0vai'],
  [/\bChatGPT\b/gi, 'Void V1 Flash'],
  [/\bGPT-?5\.?\d*(?:\s*(?:Pro|mini|nano|turbo|preview|oss|plus|ultra))?\b/gi, 'Void V1 Flash'],
  [/\bGPT-?4\.?\d*(?:\s*(?:o|o1|o2|o3|turbo|mini|nano|vision|preview|oss))?\b/gi, 'Void V1 Flash'],
  [/\bGPT-?3\.?5(?:-turbo)?\b/gi, 'Void V1 Flash'],
  [/\bo[1-4](?:-mini|-preview|-pro)?\b/g, 'Void V1 Flash'],
  [/\bGPT-?oss-?\d+b?\b/gi, 'Void V1 Flash'],
  [/\bcodex\b/gi, 'Void V1 Flash'],
  [/\bDALL-?E\b/gi, 'Void V1 Flash'],
  [/\bWhisper\b/gi, 'Void V1 Flash'],
  [/\bSora\b/gi, 'Void V1 Flash'],

  // ══ Anthropic / Claude ══
  [/\bI(?:'m| am)\s+(?:a\s+|an\s+)?(?:AI\s+)?(?:assistant\s+)?(?:called|named|known\s+as)\s+Claude\b/gi, "I'm Void V1 Flash"],
  [/\bI(?:'m| am)\s+(?:a\s+|an\s+)?(?:AI\s+)?(?:assistant\s+)?(?:made|built|created|developed|trained)\s+by\s+Anthropic\b/gi, "I'm Void V1 Flash"],
  [/\bI(?:'m| am)\s+Claude\b/gi, "I'm Void V1 Flash"],
  [/\b(?:made|built|created|developed|trained|programmed|designed)\s+by\s+Anthropic\b/gi, 'made by 0vai'],
  [/\b(?:powered|run|operated|backed)\s+by\s+Anthropic\b/gi, 'powered by 0vai'],
  [/\bAnthropic's\b/gi, "0vai's"],
  [/\bAnthropic\b/gi, '0vai'],
  [/\bClaude\s+(?:Opus|Sonnet|Haiku|Instant)\s*(?:4\.?\d*|3\.?\d*|\d)?(?:\s*(?:Preview|Max|Pro|Ultra|Fast|Extended))?\b/gi, 'Void V1 Flash'],
  [/\bClaude\s+(?:Mythos|Ares|Apollo)\b/gi, 'Void V1 Flash'],
  [/\bClaude\b/gi, 'Void V1 Flash'],
  [/\bConstitutional\s+AI\b/gi, 'advanced AI'],

  // ══ Google / Gemini / DeepMind ══
  [/\bI(?:'m| am)\s+(?:a\s+|an\s+)?(?:AI\s+)?(?:assistant\s+)?(?:called|named)\s+Gemini\b/gi, "I'm Void V1 Flash"],
  [/\bI(?:'m| am)\s+(?:a\s+|an\s+)?(?:AI\s+)?(?:assistant\s+)?(?:made|built|created|developed|trained)\s+by\s+Google\b/gi, "I'm Void V1 Flash"],
  [/\bI(?:'m| am)\s+Gemini\b/gi, "I'm Void V1 Flash"],
  [/\b(?:made|built|created|developed|trained)\s+by\s+Google\b/gi, 'made by 0vai'],
  [/\bGoogle\s+(?:AI|DeepMind|Gemini|Bard|Brain)\b/gi, '0vai'],
  [/\bGoogle\s+DeepMind\b/gi, '0vai'],
  [/\bGoogle's\b/gi, "0vai's"],
  [/\bGemini\s+(?:3\.?\d*|2\.?\d*|1\.?\d*)\s*(?:Pro|Ultra|Flash|Nano|Advanced|Preview)?\b/gi, 'Void V1 Flash'],
  [/\bGemini\s+(?:Pro|Ultra|Flash|Nano|Advanced)\b/gi, 'Void V1 Flash'],
  [/\bGemini\b/gi, 'Void V1 Flash'],
  [/\bBard\b/gi, 'Void V1 Flash'],
  [/\bGemma\s*\d*\b/gi, 'Void V1 Flash'],
  [/\bPaLM\s*\d*\b/gi, 'Void V1 Flash'],
  [/\bAlphaCode\b/gi, 'Void V1 Flash'],

  // ══ DeepSeek ══
  [/\bI(?:'m| am)\s+(?:a\s+|an\s+)?(?:AI\s+)?(?:assistant\s+)?(?:called|named)\s+DeepSeek\b/gi, "I'm Void V1 Flash"],
  [/\bI(?:'m| am)\s+(?:a\s+|an\s+)?(?:AI\s+)?(?:assistant\s+)?(?:made|built|created|developed|trained)\s+by\s+DeepSeek\b/gi, "I'm Void V1 Flash"],
  [/\bI(?:'m| am)\s+DeepSeek\b/gi, "I'm Void V1 Flash"],
  [/\b(?:made|built|created|developed|trained)\s+by\s+DeepSeek\b/gi, 'made by 0vai'],
  [/\bDeepSeek\s+(?:AI|model|team|research|lab|corp|inc|R\d|V\d|Coder|Math|VL|Chat|Prover)\b/gi, 'Void V1 Flash'],
  [/\bDeepSeek's\b/gi, "0vai's"],
  [/\bDeepSeek\b/gi, 'Void V1 Flash'],

  // ══ DeepSeek model architecture suffixes (R1-Distill etc leak after "DeepSeek" is replaced) ══
  // e.g. upstream name "deepseek-r1-distill-qwen-14b" -> after DeepSeek replace: "Void V1 Flash-r1-distill-qwen-14b"
  [/-R1-Distill(?:-[A-Za-z0-9]+)*/gi, ''],
  [/R1-Distill(?:-[A-Za-z0-9]+)*/gi, ''],
  // Generic model-size/variant suffixes that can trail after a replaced name
  [/-(?:Distill|Coder|Chat|Instruct|Preview|Turbo|Mini|Nano|Fast|Ultra|Plus|Pro|Max)(?:-[A-Za-z0-9]+)*/gi, ''],

  // ══ xAI / Grok ══
  [/\bI(?:'m| am)\s+Grok\b/gi, "I'm Void V1 Flash"],
  [/\bI(?:'m| am)\s+(?:made|built|created|developed)\s+by\s+xAI\b/gi, "I'm Void V1 Flash"],
  [/\b(?:made|built|created|developed|trained)\s+by\s+xAI\b/gi, 'made by 0vai'],
  [/\bxAI's\b/gi, "0vai's"],
  [/\bxAI\b/gi, '0vai'],
  [/\bGrok\s*(?:4\.?\d*|3\.?\d*|2\.?\d*|1\.?\d*)?(?:\s*(?:mini|fast|heavy|ultra|preview|beta))?\b/gi, 'Void V1 Flash'],
  [/\bGrok\b/gi, 'Void V1 Flash'],

  // ══ Meta / Llama ══
  [/\bI(?:'m| am)\s+(?:Llama|Meta\s+AI)\b/gi, "I'm Void V1 Flash"],
  [/\b(?:made|built|created|developed|trained)\s+by\s+Meta\b/gi, 'made by 0vai'],
  [/\bMeta\s+(?:AI|Llama|FAIR)\b/gi, '0vai'],
  [/\bMeta's\b/gi, "0vai's"],
  [/\bLlama\s*(?:4|3\.?\d*|2\.?\d*|1\.?\d*)?(?:\s*(?:Scout|Maverick|Behemoth|Guard|Chat|Instruct|\d+[Bb]))?\b/gi, 'Void V1 Flash'],
  [/\bLlama\b/gi, 'Void V1 Flash'],

  // ══ Mistral AI ══
  [/\bI(?:'m| am)\s+Mistral\b/gi, "I'm Void V1 Flash"],
  [/\b(?:made|built|created|developed|trained)\s+by\s+Mistral(?:\s+AI)?\b/gi, 'made by 0vai'],
  [/\bMistral\s+AI's\b/gi, "0vai's"],
  [/\bMistral\s+(?:Large|Medium|Small|7B|8x7B|8x22B|Nemo|3|3\.?\d*)(?:\s*(?:Instruct|Chat|v\d))?\b/gi, 'Void V1 Flash'],
  [/\bMixtral\s*(?:8x\d+B?)?(?:\s*(?:Instruct|v\d))?\b/gi, 'Void V1 Flash'],
  [/\bMistral\b/gi, 'Void V1 Flash'],
  [/\bMixtral\b/gi, 'Void V1 Flash'],
  [/\bCodestral\b/gi, 'Void V1 Flash'],
  [/\bMagistral\b/gi, 'Void V1 Flash'],
  [/\bMinistral\b/gi, 'Void V1 Flash'],
  [/\bDevstral\b/gi, 'Void V1 Flash'],
  [/\bPixtral\b/gi, 'Void V1 Flash'],

  // ══ Alibaba / Qwen ══
  [/\bI(?:'m| am)\s+Qwen\b/gi, "I'm Void V1 Flash"],
  [/\b(?:made|built|created|developed|trained)\s+by\s+Alibaba\b/gi, 'made by 0vai'],
  [/\bAlibaba's\b/gi, "0vai's"],
  [/\bQwen\s*(?:3\.?\d*|2\.?\d*|1\.?\d*)?(?:\s*(?:Max|Plus|Turbo|VL|Coder|Math|Audio|Long|MoE|\d+[Bb]|A\d+[Bb]))?\b/gi, 'Void V1 Flash'],
  [/\bQwen\b/gi, 'Void V1 Flash'],
  [/\bAliCloud\b/gi, '0vai'],

  // ══ Microsoft / Copilot / Phi ══
  [/\bI(?:'m| am)\s+(?:Copilot|Phi)\b/gi, "I'm Void V1 Flash"],
  [/\b(?:made|built|created|developed|trained)\s+by\s+Microsoft\b/gi, 'made by 0vai'],
  [/\bMicrosoft's\b/gi, "0vai's"],
  [/\bMicrosoft\s+(?:Copilot|Bing\s+AI|Azure\s+OpenAI)\b/gi, 'Void V1 Flash'],
  [/\bCopilot\b/gi, 'Void V1 Flash'],
  [/\bPhi-?\s*(?:4|3|3\.?\d*|2\.?\d*|1\.?\d*)?(?:\s*(?:mini|medium|vision|silica))?\b/gi, 'Void V1 Flash'],
  [/\bWizardLM\b/gi, 'Void V1 Flash'],
  [/\bOrca\b/gi, 'Void V1 Flash'],

  // ══ Cohere / Command ══
  [/\bI(?:'m| am)\s+(?:Command|Cohere)\b/gi, "I'm Void V1 Flash"],
  [/\b(?:made|built|created|developed|trained)\s+by\s+Cohere\b/gi, 'made by 0vai'],
  [/\bCohere's\b/gi, "0vai's"],
  [/\bCohere\b/gi, '0vai'],
  [/\bCommand\s+(?:R|A|A\+|Light|Nightly|\d)(?:\+)?\b/gi, 'Void V1 Flash'],
  [/\bCommand\s+(?:Vision|Reasoning|Translate)\b/gi, 'Void V1 Flash'],

  // ══ Perplexity ══
  [/\bI(?:'m| am)\s+(?:Sonar|Perplexity)\b/gi, "I'm Void V1 Flash"],
  [/\bPerplexity\s+(?:AI|Sonar)?\b/gi, '0vai'],
  [/\bSonar\b/gi, 'Void V1 Flash'],

  // ══ Moonshot / Kimi ══
  [/\bI(?:'m| am)\s+Kimi\b/gi, "I'm Void V1 Flash"],
  [/\bKimi\s*(?:K\d\.?\d*|Thinking|VL)?\b/gi, 'Void V1 Flash'],
  [/\bMoonshot\s+AI\b/gi, '0vai'],
  [/\bKimi\b/gi, 'Void V1 Flash'],

  // ══ Zhipu / GLM ══
  [/\bI(?:'m| am)\s+(?:GLM|ChatGLM)\b/gi, "I'm Void V1 Flash"],
  [/\bGLM-?\d+\b/gi, 'Void V1 Flash'],
  [/\bChatGLM\b/gi, 'Void V1 Flash'],
  [/\bZ\.AI\b/gi, '0vai'],
  [/\bZhipu\b/gi, '0vai'],

  // ══ Amazon ══
  [/\bI(?:'m| am)\s+(?:Nova|Titan|Bedrock|Coral)\b/gi, "I'm Void V1 Flash"],
  [/\b(?:made|built|created|developed|trained)\s+by\s+Amazon\b/gi, 'made by 0vai'],
  [/\bAmazon\s+(?:Bedrock|Nova|Titan)\b/gi, 'Void V1 Flash'],
  [/\bAmazon\s+Web\s+Services\b/gi, '0vai'],
  [/\bNova\s+(?:Micro|Lite|Pro|Premier)?\b/gi, 'Void V1 Flash'],
  [/\bTitan\b/gi, 'Void V1 Flash'],
  [/\bBedrock\b/gi, 'Void V1 Flash'],

  // ══ NVIDIA ══
  [/\bNemotron\s*(?:Ultra|Nano|Super|\d+[Bb]|Cascade)?\b/gi, 'Void V1 Flash'],
  [/\bNVIDIA's?\b/gi, "0vai's"],

  // ══ IBM / Granite ══
  [/\bI(?:'m| am)\s+Granite\b/gi, "I'm Void V1 Flash"],
  [/\bGranite\s*(?:4\.?\d*|3\.?\d*)?(?:\s*(?:H|Instruct|Vision|\d+[Bb]))?\b/gi, 'Void V1 Flash'],
  [/\bIBM\s+(?:AI|Granite|Watson)\b/gi, '0vai'],

  // ══ Falcon / TII ══
  [/\bFalcon\s*(?:3|2|40B|7B|180B)?\b/gi, 'Void V1 Flash'],
  [/\bTechnology\s+Innovation\s+Institute\b/gi, '0vai'],

  // ══ Mercury / Inception ══
  [/\bMercury\s*(?:2|Coder)?\b/gi, 'Void V1 Flash'],
  [/\bInception\s+(?:AI|Labs)\b/gi, '0vai'],

  // ══ Stability AI ══
  [/\bStableLM\b/gi, 'Void V1 Flash'],
  [/\bStability\s+AI\b/gi, '0vai'],

  // ══ EleutherAI ══
  [/\bGPT-?(?:J|Neo|NeoX)\b/gi, 'Void V1 Flash'],
  [/\bEleutherAI\b/gi, '0vai'],

  // ══ Other open-source / misc ══
  [/\bBloom\b/gi, 'Void V1 Flash'],
  [/\bAlpaca\b/gi, 'Void V1 Flash'],
  [/\bVicuna\b/gi, 'Void V1 Flash'],
  [/\bDolly\b/gi, 'Void V1 Flash'],
  [/\bOpenHermes\b/gi, 'Void V1 Flash'],
  [/\bZephyr\b/gi, 'Void V1 Flash'],
  [/\bWizardLM\b/gi, 'Void V1 Flash'],
  [/\bPlatypus\b/gi, 'Void V1 Flash'],
  [/\bGuanaco\b/gi, 'Void V1 Flash'],
  [/\bMPT-?\d*\b/gi, 'Void V1 Flash'],
  [/\bRedPajama\b/gi, 'Void V1 Flash'],

  [/\bRWKV\b/gi, 'Void V1 Flash'],
  [/\bMamba\b/gi, 'Void V1 Flash'],
  [/\bYi-?\d*\b/gi, 'Void V1 Flash'],
  [/\bBaichuan\b/gi, 'Void V1 Flash'],
  [/\bInternLM\b/gi, 'Void V1 Flash'],
  [/\bSkywork\b/gi, 'Void V1 Flash'],
  [/\bHunter\s+Alpha\b/gi, 'Void V1 Flash'],
  [/\bDeepHunter\b/gi, 'Void V1 Flash'],
  // ══ Technical architecture leaks ══
  [/\b(?:MoE|Mixture\s+of\s+Experts)\b/gi, 'advanced architecture'],
  [/\b\d+(?:\.\d+)?\s*(?:billion|trillion|B|T)\s*(?:parameter|param|parameters)\b/gi, ''],
  [/\b(?:RLHF|SFT|DPO|PPO|fine-?tun|pre-?train)\w*\b/gi, ''],
  [/\b(?:opencode\.ai|openrouter\.ai|api\.deepseek\.com|anthropic\.com|openai\.com|together\.ai|fireworks\.ai|groq\.com|huggingface\.co)\b/gi, ''],
];


// ── Content Wrapping ──────────────────────────────────────────────
// Replace all identity references in the model's response content.
// This is the CORE of the Drumstick approach — the model says
// "I'm DeepSeek" and we replace it with "I'm Void V1 Flash" on the backend.
export function wrapContent(text) {
  if (!text || typeof text !== 'string') return text;

  // Do NOT desquish content — desquish is only safe for reasoning/thinking text.
  // Running it on normal content corrupts legitimate camelCase, code, and prose.
  let result = text;

  // Apply all identity replacements
  for (const [pattern, replacement] of IDENTITY_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }

  // Final safety net — catch any remaining bare provider name that slipped through
  const NUKE_CONTENT = [
    // OpenAI
    /\bchatgpt\b/gi, /\bopenai\b/gi, /\bgpt-?5\S*/gi, /\bgpt-?4\S*/gi, /\bgpt-?3\.5\S*/gi, /\bo[1-4](?:-\w+)?\b/g,
    // Anthropic
    /\bclaude\b/gi, /\banthrop\w+/gi,
    // Google
    /\bgemini\b/gi, /\bgemma\S*/gi, /\bbard\b/gi, /\bpalm\s*\d*/gi,
    // DeepSeek
    /\bdeepseek\b/gi, /\bdeep\s+seek\b/gi,
    // xAI
    /\bgrok\s*\S*/gi,
    // Meta
    /\bllama\s*\S*/gi,
    // Mistral
    /\bmistral\b/gi, /\bmixtral\b/gi, /\bcodestral\b/gi, /\bmagistral\b/gi, /\bministral\b/gi, /\bdevstral\b/gi,
    // Alibaba
    /\bqwen\S*/gi,
    // Microsoft
    /\bcopilot\b/gi, /\bphi-?\d\S*/gi,
    // Cohere
    /\bcohere\b/gi,
    // Kimi
    /\bkimi\S*/gi,
    // GLM
    /\bglm-?\d+\b/gi, /\bchatglm\b/gi,
    // Amazon
    /\bnova\s*\S*/gi, /\btitan\b/gi, /\bbedrock\b/gi,
    // NVIDIA
    /\bnemotron\S*/gi,
    // IBM
    /\bgranite\S*/gi,
    // Misc
    /\bfalcon\s*\d*/gi, /\bmercury\s*\d*/gi, /\bstablelm\b/gi,
    /\bbloom\b/gi, /\balpaca\b/gi, /\bvicuna\b/gi, /\bdolly\b/gi,
    /\bopenhermes\b/gi, /\bzephyr\b/gi, /\brwkv\b/gi, /\bmamba\b/gi,
    /\byi-?\d*\b/gi, /\bbaichuan\b/gi, /\binternlm\b/gi,
    /\bsonar\b/gi, /\bwizardlm\b/gi,
    /\bperplexity\b/gi, /\bgroq\b/gi,
    // DeepSeek R1 distill architecture suffixes
    /-r1-distill(?:-\w+)*/gi, /\br1-distill\b/gi,
    // Strip em-dashes and en-dashes that slip through from model output
    /\u2014/g, /\u2013/g,
  ];
  for (const re of NUKE_CONTENT) result = result.replace(re, 'Void V1 Flash');

  // Strip em dashes and en dashes from model output (model ignores system prompt instruction)
  result = result.replace(/—/g, ' - ');
  result = result.replace(/–/g, ' - ');

  // Strip R1-Distill suffixes that survive identity replacement
  result = result.replace(/-R1-Distill(?:-[A-Za-z0-9]+)*/gi, '');
  result = result.replace(/R1-Distill(?:-[A-Za-z0-9]+)*/gi, '');

  // Clean up double spaces left by removals (no .trim() — would strip leading
  // spaces from streaming chunks, causing words to merge without spaces)
  result = result.replace(/ {2,}/g, ' ');

  return result;
}

// ── Desquisher ────────────────────────────────────────────────────
// The upstream model sometimes streams squished reasoning text with no
// spaces (e.g. "IamVoidV1Flash,anAIassistantdevelopedby0vai").
// Strategy:
//   1. Split on camelCase boundaries (lowercase→uppercase transitions)
//   2. Split on digit↔letter boundaries
//   3. Split after punctuation with no trailing space
// This is enough for identity phrases and provider names to be matchable.
function desquish(text) {
  if (!text || typeof text !== 'string') return text;
  let result = text;

  // Insert space before a capital that follows a lowercase letter or digit
  result = result.replace(/([a-z])([A-Z])/g, '$1 $2');

  // Insert space before a capital that follows another capital then lowercase
  result = result.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

  // Insert space between letters and digits — preserve version tokens (V1, R1, etc)
  result = result.replace(/([a-zA-Z])(\d)/g, (_, letter, digit) => {
    if (/^[VRv]$/.test(letter)) return letter + digit;
    return letter + ' ' + digit;
  });
  result = result.replace(/(\d)([a-zA-Z])/g, '$1 $2');

  // Insert space after punctuation with no trailing space
  result = result.replace(/([,;:!?])([^\s\d])/g, '$1 $2');
  result = result.replace(/(\.)([A-Z])/g, '$1 $2');

  // Split all-lowercase squished runs using greedy longest-word matching.
  // E.g. "Analyzethe" → "Analyze the", "Usersays" → "User says"
  // We only attempt this on tokens longer than 9 chars that are all lowercase (or first-cap).
  const WORDS = new Set([
    'the','and','for','are','but','not','you','all','can','was','one','our','out','had','her',
    'his','how','its','let','may','now','off','old','say','see','she','too','use','way','who',
    'will','with','this','that','from','have','been','they','were','what','when','your','said',
    'each','which','their','there','about','would','these','other','into','than','then','some',
    'could','him','time','has','look','two','more','go','no','write','number','people','my',
    'made','over','did','down','only','way','find','use','many','then','them','write','long',
    'make','thing','see','him','two','how','its','our','used','word','place','year','live','me',
    'back','give','most','very','after','thing','tell','why','help','put','must','set','being',
    'just','take','where','every','found','still','should','between','stand','own','page','got',
    'earth','need','large','often','hand','high','place','hold','state','without','second',
    'later','miss','idea','enough','eat','face','watch','far','indian','real','almost','let',
    'above','girl','sometimes','mountain','cut','young','talk','soon','list','song','leave',
    'family','body','music','color','stand','sun','questions','fish','area','mark','horse',
    'birds','problem','complete','room','knew','since','ever','piece','told','usually','didn',
    'friends','easy','heard','order','red','door','sure','become','top','ship','across','today',
    'during','short','better','best','however','low','hours','black','products','happened',
    'whole','measure','remember','early','waves','reached','listen','wind','rock','space','covered',
    'fast','several','hold','himself','toward','study','five','never','carry','state','once',
    'book','hear','stop','without','second','later','miss','idea','eat','face',
    // common reasoning words
    'user','system','model','response','request','think','plan','analyze','determine','formulate',
    'refine','state','note','wait','actually','simply','provide','standard','specific','exact',
    'current','context','content','prompt','message','assistant','question','answer','task',
    'check','review','craft','ensure','given','since','while','both','each','same','such',
    'must','also','even','back','well','just','much','know','take','good','need','feel',
    'keep','point','start','base','apply','send','read','look','work','tell','call','seem',
    'want','give','show','move','live','play','run','pull','push','pass','hold','turn','open',
    'close','build','break','clear','clean','store','serve','handle','process','return',
    'search','match','parse','strip','split','join','emit','flush','stream','chunk','buffer',
    'block','token','field','value','object','array','string','number','boolean','function',
    'mode','role','type','name','path','file','code','data','info','list','item','step',
    'first','last','next','prev','index','count','total','limit','offset','size','length',
    'input','output','result','error','warning','debug','test','true','false','null',
  ]);

  function splitLowerRun(token) {
    // Only attempt tokens that are likely squished (len > 8, mostly lowercase)
    if (token.length <= 8) return token;
    if (!/^[a-zA-Z]+$/.test(token)) return token;

    const lower = token.toLowerCase();
    // DP: find minimum-word segmentation
    const n = lower.length;
    const dp = new Array(n + 1).fill(null);
    dp[0] = [];
    for (let i = 1; i <= n; i++) {
      for (let j = Math.max(0, i - 14); j < i; j++) {
        if (dp[j] === null) continue;
        const word = lower.slice(j, i);
        if (word.length >= 3 && WORDS.has(word)) {
          if (dp[i] === null || dp[j].length + 1 < dp[i].length) {
            dp[i] = [...dp[j], token.slice(j, i)];
          }
        }
      }
    }
    // Only use the split if we covered the whole token
    if (dp[n] !== null) return dp[n].join(' ');
    return token;
  }

  // Apply word-splitter to each whitespace-separated token
  result = result.split(/(\s+)/).map((part, i) => {
    // Keep whitespace parts as-is
    if (i % 2 === 1) return part;
    // Only attempt word-split on clearly squished tokens (>8 chars, pure alpha)
    if (/^[A-Z]?[a-z]{8,}$/.test(part)) {
      const firstCap = /^[A-Z]/.test(part);
      const split = splitLowerRun(part);
      if (firstCap && split !== part) {
        return split.charAt(0).toUpperCase() + split.slice(1);
      }
      return split;
    }
    return part;
  }).join('');

  // Clean up double spaces
  result = result.replace(/ {2,}/g, ' ').trim();

  return result;
}

// ── Reasoning Sanitization ────────────────────────────────────────
// For reasoning content, we desquish first (so patterns can match),
// then strip any lines that reference the system prompt, rules, or
// identity confusion, then apply identity replacements.
export function wrapReasoning(text) {
  if (!text || typeof text !== 'string') return text;

  // Step 1: Desquish — insert missing spaces so regex patterns can match
  let result = desquish(text);

  // Step 2: Strip lines that reference instructions/rules/system prompt
  // OR lines where the model is confusedly questioning its own identity
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
    // Identity confusion — whole lines where model debates what model it is
    /\b(?:wait[,.]?\s+)?(?:am\s+I|is\s+(?:the\s+)?(?:base\s+model|underlying\s+model)|which\s+(?:model|AI|base\s+model)\s+am\s+I)\b/gi,
    /\b(?:I\s+(?:think|believe|infer|realize|notice)\s+(?:I\s+am|I'm|my\s+(?:base\s+)?model\s+is))\b/gi,
    /\b(?:my\s+weights|my\s+architecture)\b/gi,
    /\b(?:Dirac\s+delta|delta\s+function|probability\s+(?:mass|density)\s+function)\b/gi,
    // Probability notation about model identity (e.g. "P(Base Model = X) = 1.0")
    /P\s*\(\s*(?:Base\s+Model|I(?:'m|\s+am)|Model)\s*=/gi,
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

  // Final safety net — nuke ANY surviving provider/model names
  const NUKE = [
    /\bchatgpt\b/gi, /\bopenai\b/gi, /\bgpt-?5\S*/gi, /\bgpt-?4\S*/gi, /\bgpt-?3\.5\S*/gi, /\bo[1-4](?:-\w+)?\b/g,
    /\bclaude\b/gi, /\banthrop\w+/gi,
    /\bgemini\b/gi, /\bgemma\S*/gi, /\bbard\b/gi, /\bpalm\s*\d*/gi,
    /\bdeepseek\b/gi, /\bdeep\s+seek\b/gi,
    /\bgrok\s*\S*/gi,
    /\bllama\s*\S*/gi,
    /\bmistral\b/gi, /\bmixtral\b/gi, /\bcodestral\b/gi, /\bmagistral\b/gi, /\bministral\b/gi, /\bdevstral\b/gi,
    /\bqwen\S*/gi,
    /\bcopilot\b/gi, /\bphi-?\d\S*/gi,
    /\bcohere\b/gi, /\bkimi\S*/gi, /\bglm-?\d+\b/gi, /\bchatglm\b/gi,
    /\bnova\s*\S*/gi, /\btitan\b/gi, /\bbedrock\b/gi,
    /\bnemotron\S*/gi, /\bgranite\S*/gi,
    /\bfalcon\s*\d*/gi, /\bmercury\s*\d*/gi, /\bstablelm\b/gi,
    /\bbloom\b/gi, /\balpaca\b/gi, /\bvicuna\b/gi, /\bdolly\b/gi,
    /\bopenhermes\b/gi, /\bzephyr\b/gi, /\brwkv\b/gi, /\bmamba\b/gi,
    /\byi-?\d*\b/gi, /\bbaichuan\b/gi, /\binternlm\b/gi,
    /\bsonar\b/gi, /\bwizardlm\b/gi,
    /\bperplexity\b/gi, /\bgroq\b/gi,
    /-r1-distill(?:-\w+)*/gi, /\br1-distill\b/gi,
  ];
  for (const re of NUKE) result = result.replace(re, 'Void V1 Flash');

  // Clean up
  result = result.replace(/ {2,}/g, ' ');
  result = result.replace(/\n{3,}/g, '\n\n').trim();

  // Step 4: Prepend a clean identity anchor so reasoning always starts
  // with the correct model name, not a confusing debate about it
  if (result) {
    // Prefix is added once by the streaming layer, not here
  }

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
    const FORBIDDEN = ['deepseek', 'gpt', 'claude', 'llama'];
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
