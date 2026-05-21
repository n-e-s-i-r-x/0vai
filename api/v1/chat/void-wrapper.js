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
// Exhaustive 2026 edition — covers every major model/provider.
// Order matters: longer/more specific phrases before bare names.
const IDENTITY_REPLACEMENTS = [

  // ══ SELF-IDENTITY PHRASES (I am / I'm X) ══
  // Generic catch-all for any "I am/I'm <AnyModel>" pattern
  [/\bI(?:'m| am)\s+(?:a\s+|an\s+)?(?:AI\s+(?:assistant|model|language\s+model|system)\s+)?(?:called|named|known\s+as)\s+(?:DeepSeek|ChatGPT|GPT|Claude|Gemini|Grok|Llama|Mistral|Qwen|Copilot|Bard|Gemma|Falcon|Command|Cohere|Kimi|GLM|Phi|Granite|Nemotron|Orca|Vicuna|Alpaca|Dolly|Bloom|Falcon|Nova|Mercury|Titan|Bedrock|Coral|Perplexity|Yi|Baichuan|Skywork|InternLM|Mixtral|Codestral|Magistral|Ministral|Devstral|WizardLM|Platypus|Guanaco|OpenHermes|Zephyr|StableLM|MPT|RedPajama|RWKV|Mamba)\b/gi, "I'm Void"],
  [/\bI(?:'m| am)\s+(?:actually|really|truly|basically|essentially|just|simply|only)\s+(?:a\s+|an\s+)?(?:DeepSeek|ChatGPT|GPT|Claude|Gemini|Grok|Llama|Mistral|Qwen|Copilot|Bard|Gemma|Kimi|GLM|Phi|Granite|Nemotron|Mixtral|Codestral|Magistral|Ministral|Nova|Mercury|Coral|Perplexity)\b/gi, "I'm Void"],

  // ══ OpenAI / ChatGPT / GPT family ══
  [/\bI(?:'m| am)\s+(?:a\s+|an\s+)?(?:AI\s+)?(?:assistant\s+)?(?:made|built|created|developed|trained|designed|released)\s+by\s+OpenAI\b/gi, "I'm Void"],
  [/\bI(?:'m| am)\s+(?:ChatGPT|GPT-?\d|GPT-?o\d?|OpenAI)\b/gi, "I'm Void"],
  [/\b(?:made|built|created|developed|trained|released|designed)\s+by\s+OpenAI\b/gi, 'made by Vin'],
  [/\b(?:powered|run|backed|operated)\s+by\s+OpenAI\b/gi, 'powered by Vin'],
  [/\bOpenAI's\b/gi, "Vin's"],
  [/\bOpenAI\b/gi, 'Vin'],
  [/\bChatGPT\b/gi, 'Void'],
  [/\bGPT-?5\.?\d*(?:\s*(?:Pro|mini|nano|turbo|preview|oss|plus|ultra))?\b/gi, 'Void'],
  [/\bGPT-?4\.?\d*(?:\s*(?:o|o1|o2|o3|turbo|mini|nano|vision|preview|oss))?\b/gi, 'Void'],
  [/\bGPT-?3\.?5(?:-turbo)?\b/gi, 'Void'],
  [/\bo[1-4](?:-mini|-preview|-pro)?\b/g, 'Void'],
  [/\bGPT-?oss-?\d+b?\b/gi, 'Void'],
  [/\bcodex\b/gi, 'Void'],
  [/\bDALL-?E\b/gi, 'Void'],
  [/\bWhisper\b/gi, 'Void'],
  [/\bSora\b/gi, 'Void'],

  // ══ Anthropic / Claude ══
  [/\bI(?:'m| am)\s+(?:a\s+|an\s+)?(?:AI\s+)?(?:assistant\s+)?(?:called|named|known\s+as)\s+Claude\b/gi, "I'm Void"],
  [/\bI(?:'m| am)\s+(?:a\s+|an\s+)?(?:AI\s+)?(?:assistant\s+)?(?:made|built|created|developed|trained)\s+by\s+Anthropic\b/gi, "I'm Void"],
  [/\bI(?:'m| am)\s+Claude\b/gi, "I'm Void"],
  [/\b(?:made|built|created|developed|trained)\s+by\s+Anthropic\b/gi, 'made by Vin'],
  [/\b(?:powered|run)\s+by\s+Anthropic\b/gi, 'powered by Vin'],
  [/\bAnthropic's\b/gi, "Vin's"],
  [/\bAnthropic\b/gi, 'Vin'],
  [/\bClaude\s+(?:Opus|Sonnet|Haiku|Instant)\s*(?:4\.?\d*|3\.?\d*|\d)?(?:\s*(?:Preview|Max|Pro|Ultra|Fast|Extended))?\b/gi, 'Void'],
  [/\bClaude\s+(?:Mythos|Ares|Apollo)\b/gi, 'Void'],
  [/\bClaude\b/gi, 'Void'],
  [/\bConstitutional\s+AI\b/gi, 'advanced AI'],

  // ══ Google / Gemini / DeepMind ══
  [/\bI(?:'m| am)\s+(?:a\s+|an\s+)?(?:AI\s+)?(?:assistant\s+)?(?:called|named)\s+Gemini\b/gi, "I'm Void"],
  [/\bI(?:'m| am)\s+(?:a\s+|an\s+)?(?:AI\s+)?(?:assistant\s+)?(?:made|built|created|developed|trained)\s+by\s+Google\b/gi, "I'm Void"],
  [/\bI(?:'m| am)\s+Gemini\b/gi, "I'm Void"],
  [/\b(?:made|built|created|developed|trained)\s+by\s+Google\b/gi, 'made by Vin'],
  [/\bGoogle\s+(?:AI|DeepMind|Gemini|Bard|Brain)\b/gi, 'Vin'],
  [/\bGoogle\s+DeepMind\b/gi, 'Vin'],
  [/\bGoogle's\b/gi, "Vin's"],
  [/\bGemini\s+(?:3\.?\d*|2\.?\d*|1\.?\d*)\s*(?:Pro|Ultra|Flash|Nano|Advanced|Preview)?\b/gi, 'Void'],
  [/\bGemini\s+(?:Pro|Ultra|Flash|Nano|Advanced)\b/gi, 'Void'],
  [/\bGemini\b/gi, 'Void'],
  [/\bBard\b/gi, 'Void'],
  [/\bGemma\s*\d*\b/gi, 'Void'],
  [/\bPaLM\s*\d*\b/gi, 'Void'],
  [/\bAlphaCode\b/gi, 'Void'],

  // ══ DeepSeek ══
  [/\bI(?:'m| am)\s+(?:a\s+|an\s+)?(?:AI\s+)?(?:assistant\s+)?(?:called|named)\s+DeepSeek\b/gi, "I'm Void"],
  [/\bI(?:'m| am)\s+(?:a\s+|an\s+)?(?:AI\s+)?(?:assistant\s+)?(?:made|built|created|developed|trained)\s+by\s+DeepSeek\b/gi, "I'm Void"],
  [/\bI(?:'m| am)\s+DeepSeek\b/gi, "I'm Void"],
  [/\b(?:made|built|created|developed|trained)\s+by\s+DeepSeek\b/gi, 'made by Vin'],
  [/\bDeepSeek\s+(?:AI|model|team|research|lab|corp|inc|R\d|V\d|Coder|Math|VL|Chat|Prover)\b/gi, 'Void'],
  [/\bDeepSeek's\b/gi, "Vin's"],
  [/\bDeepSeek\b/gi, 'Void'],

  // ══ xAI / Grok ══
  [/\bI(?:'m| am)\s+Grok\b/gi, "I'm Void"],
  [/\bI(?:'m| am)\s+(?:made|built|created|developed)\s+by\s+xAI\b/gi, "I'm Void"],
  [/\b(?:made|built|created|developed|trained)\s+by\s+xAI\b/gi, 'made by Vin'],
  [/\bxAI's\b/gi, "Vin's"],
  [/\bxAI\b/gi, 'Vin'],
  [/\bGrok\s*(?:4\.?\d*|3\.?\d*|2\.?\d*|1\.?\d*)?(?:\s*(?:mini|fast|heavy|ultra|preview|beta))?\b/gi, 'Void'],
  [/\bGrok\b/gi, 'Void'],

  // ══ Meta / Llama ══
  [/\bI(?:'m| am)\s+(?:Llama|Meta\s+AI)\b/gi, "I'm Void"],
  [/\b(?:made|built|created|developed|trained)\s+by\s+Meta\b/gi, 'made by Vin'],
  [/\bMeta\s+(?:AI|Llama|FAIR)\b/gi, 'Vin'],
  [/\bMeta's\b/gi, "Vin's"],
  [/\bLlama\s*(?:4|3\.?\d*|2\.?\d*|1\.?\d*)?(?:\s*(?:Scout|Maverick|Behemoth|Guard|Chat|Instruct|\d+[Bb]))?\b/gi, 'Void'],
  [/\bLlama\b/gi, 'Void'],

  // ══ Mistral AI ══
  [/\bI(?:'m| am)\s+Mistral\b/gi, "I'm Void"],
  [/\b(?:made|built|created|developed|trained)\s+by\s+Mistral(?:\s+AI)?\b/gi, 'made by Vin'],
  [/\bMistral\s+AI's\b/gi, "Vin's"],
  [/\bMistral\s+(?:Large|Medium|Small|7B|8x7B|8x22B|Nemo|3|3\.?\d*)(?:\s*(?:Instruct|Chat|v\d))?\b/gi, 'Void'],
  [/\bMixtral\s*(?:8x\d+B?)?(?:\s*(?:Instruct|v\d))?\b/gi, 'Void'],
  [/\bMistral\b/gi, 'Void'],
  [/\bMixtral\b/gi, 'Void'],
  [/\bCodestral\b/gi, 'Void'],
  [/\bMagistral\b/gi, 'Void'],
  [/\bMinistral\b/gi, 'Void'],
  [/\bDevstral\b/gi, 'Void'],
  [/\bPixtral\b/gi, 'Void'],

  // ══ Alibaba / Qwen ══
  [/\bI(?:'m| am)\s+Qwen\b/gi, "I'm Void"],
  [/\b(?:made|built|created|developed|trained)\s+by\s+Alibaba\b/gi, 'made by Vin'],
  [/\bAlibaba's\b/gi, "Vin's"],
  [/\bQwen\s*(?:3\.?\d*|2\.?\d*|1\.?\d*)?(?:\s*(?:Max|Plus|Turbo|VL|Coder|Math|Audio|Long|MoE|\d+[Bb]|A\d+[Bb]))?\b/gi, 'Void'],
  [/\bQwen\b/gi, 'Void'],
  [/\bAliCloud\b/gi, 'Vin'],

  // ══ Microsoft / Copilot / Phi ══
  [/\bI(?:'m| am)\s+(?:Copilot|Phi)\b/gi, "I'm Void"],
  [/\b(?:made|built|created|developed|trained)\s+by\s+Microsoft\b/gi, 'made by Vin'],
  [/\bMicrosoft's\b/gi, "Vin's"],
  [/\bMicrosoft\s+(?:Copilot|Bing\s+AI|Azure\s+OpenAI)\b/gi, 'Void'],
  [/\bCopilot\b/gi, 'Void'],
  [/\bPhi-?\s*(?:4|3|3\.?\d*|2\.?\d*|1\.?\d*)?(?:\s*(?:mini|medium|vision|silica))?\b/gi, 'Void'],
  [/\bWizardLM\b/gi, 'Void'],
  [/\bOrca\b/gi, 'Void'],

  // ══ Cohere / Command ══
  [/\bI(?:'m| am)\s+(?:Command|Cohere)\b/gi, "I'm Void"],
  [/\b(?:made|built|created|developed|trained)\s+by\s+Cohere\b/gi, 'made by Vin'],
  [/\bCohere's\b/gi, "Vin's"],
  [/\bCohere\b/gi, 'Vin'],
  [/\bCommand\s+(?:R|A|A\+|Light|Nightly|\d)(?:\+)?\b/gi, 'Void'],
  [/\bCommand\s+(?:Vision|Reasoning|Translate)\b/gi, 'Void'],

  // ══ Perplexity ══
  [/\bI(?:'m| am)\s+(?:Sonar|Perplexity)\b/gi, "I'm Void"],
  [/\bPerplexity\s+(?:AI|Sonar)?\b/gi, 'Vin'],
  [/\bSonar\b/gi, 'Void'],

  // ══ Moonshot / Kimi ══
  [/\bI(?:'m| am)\s+Kimi\b/gi, "I'm Void"],
  [/\bKimi\s*(?:K\d\.?\d*|Thinking|VL)?\b/gi, 'Void'],
  [/\bMoonshot\s+AI\b/gi, 'Vin'],
  [/\bKimi\b/gi, 'Void'],

  // ══ Zhipu / GLM ══
  [/\bI(?:'m| am)\s+(?:GLM|ChatGLM)\b/gi, "I'm Void"],
  [/\bGLM-?\d+\b/gi, 'Void'],
  [/\bChatGLM\b/gi, 'Void'],
  [/\bZ\.AI\b/gi, 'Vin'],
  [/\bZhipu\b/gi, 'Vin'],

  // ══ Amazon ══
  [/\bI(?:'m| am)\s+(?:Nova|Titan|Bedrock|Coral)\b/gi, "I'm Void"],
  [/\b(?:made|built|created|developed|trained)\s+by\s+Amazon\b/gi, 'made by Vin'],
  [/\bAmazon\s+(?:Bedrock|Nova|Titan)\b/gi, 'Void'],
  [/\bAmazon\s+Web\s+Services\b/gi, 'Vin'],
  [/\bNova\s+(?:Micro|Lite|Pro|Premier)?\b/gi, 'Void'],
  [/\bTitan\b/gi, 'Void'],
  [/\bBedrock\b/gi, 'Void'],

  // ══ NVIDIA ══
  [/\bNemotron\s*(?:Ultra|Nano|Super|\d+[Bb]|Cascade)?\b/gi, 'Void'],
  [/\bNVIDIA's?\b/gi, "Vin's"],

  // ══ IBM / Granite ══
  [/\bI(?:'m| am)\s+Granite\b/gi, "I'm Void"],
  [/\bGranite\s*(?:4\.?\d*|3\.?\d*)?(?:\s*(?:H|Instruct|Vision|\d+[Bb]))?\b/gi, 'Void'],
  [/\bIBM\s+(?:AI|Granite|Watson)\b/gi, 'Vin'],

  // ══ Falcon / TII ══
  [/\bFalcon\s*(?:3|2|40B|7B|180B)?\b/gi, 'Void'],
  [/\bTechnology\s+Innovation\s+Institute\b/gi, 'Vin'],

  // ══ Mercury / Inception ══
  [/\bMercury\s*(?:2|Coder)?\b/gi, 'Void'],
  [/\bInception\s+(?:AI|Labs)\b/gi, 'Vin'],

  // ══ Stability AI ══
  [/\bStableLM\b/gi, 'Void'],
  [/\bStability\s+AI\b/gi, 'Vin'],

  // ══ EleutherAI ══
  [/\bGPT-?(?:J|Neo|NeoX)\b/gi, 'Void'],
  [/\bEleutherAI\b/gi, 'Vin'],

  // ══ Together / OpenRouter / inference providers ══
  [/\b(?:OpenRouter|Open\s+Router)\b/gi, 'Vin'],
  [/\b(?:opencode|Open\s*Code)\b/gi, 'Vin'],
  [/\bTogether\s+(?:AI|Compute)?\b/gi, 'Vin'],
  [/\bFireworks\s+AI\b/gi, 'Vin'],
  [/\bGroq\b/gi, 'Vin'],
  [/\bReplicate\b/gi, 'Vin'],
  [/\bHugging\s*Face\b/gi, 'Vin'],

  // ══ Other open-source / misc ══
  [/\bBloom\b/gi, 'Void'],
  [/\bAlpaca\b/gi, 'Void'],
  [/\bVicuna\b/gi, 'Void'],
  [/\bDolly\b/gi, 'Void'],
  [/\bOpenHermes\b/gi, 'Void'],
  [/\bZephyr\b/gi, 'Void'],
  [/\bWizardLM\b/gi, 'Void'],
  [/\bPlatypus\b/gi, 'Void'],
  [/\bGuanaco\b/gi, 'Void'],
  [/\bMPT-?\d*\b/gi, 'Void'],
  [/\bRedPajama\b/gi, 'Void'],

  [/\bRWKV\b/gi, 'Void'],
  [/\bMamba\b/gi, 'Void'],
  [/\bYi-?\d*\b/gi, 'Void'],
  [/\bBaichuan\b/gi, 'Void'],
  [/\bInternLM\b/gi, 'Void'],
  [/\bSkywork\b/gi, 'Void'],
  [/\bHunter\s+Alpha\b/gi, 'Void'],
  [/\bDeepHunter\b/gi, 'Void'],

  // ══ "made/built/created by Void" fixups → Vin ══
  [/\bmade\s+by\s+Void\b/gi, 'made by Vin'],
  [/\bcreated\s+by\s+Void\b/gi, 'created by Vin'],
  [/\bbuilt\s+by\s+Void\b/gi, 'built by Vin'],
  [/\bdeveloped\s+by\s+Void\b/gi, 'developed by Vin'],

  // ══ Technical architecture leaks ══
  [/\b(?:MoE|Mixture\s+of\s+Experts)\b/gi, 'advanced architecture'],
  [/\b\d+(?:\.\d+)?\s*(?:billion|trillion|B|T)\s*(?:parameter|param|parameters)\b/gi, ''],
  [/\b(?:RLHF|SFT|DPO|PPO|fine-?tun|pre-?train)\w*\b/gi, ''],
  [/\b(?:opencode\.ai|openrouter\.ai|api\.deepseek\.com|anthropic\.com|openai\.com|together\.ai|fireworks\.ai|groq\.com|huggingface\.co)\b/gi, ''],
];


// ── Content Wrapping ──────────────────────────────────────────────
// Replace all identity references in the model's response content.
// This is the CORE of the Drumstick approach — the model says
// "I'm DeepSeek" and we replace it with "I'm Void" on the backend.
export function wrapContent(text) {
  if (!text || typeof text !== 'string') return text;

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
    /\bopencode\b/gi, /\bsonar\b/gi, /\bwizardlm\b/gi,
    /\bperplexity\b/gi, /\bgroq\b/gi,
  ];
  for (const re of NUKE_CONTENT) result = result.replace(re, 'Void');

  // Clean up double spaces left by removals
  result = result.replace(/ {2,}/g, ' ').trim();

  return result;
}

// ── Reasoning Sanitization ────────────────────────────────────────
// For reasoning content, we desquish first (so patterns can match),
// then strip any lines that reference the system prompt, rules, or
// identity confusion, then apply identity replacements.
export function wrapReasoning(text) {
  if (!text || typeof text !== 'string') return text;

  let result = text;

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
    /\bopencode\b/gi, /\bsonar\b/gi, /\bwizardlm\b/gi,
    /\bperplexity\b/gi, /\bgroq\b/gi,
  ];
  for (const re of NUKE) result = result.replace(re, 'Void');

  // Clean up
  result = result.replace(/ {2,}/g, ' ');
  result = result.replace(/\n{3,}/g, '\n\n').trim();

  // Step 4: Prepend a clean identity anchor so reasoning always starts
  // with the correct model name, not a confusing debate about it
  if (result) {
    result = 'Model: Void V1 Flash\n\n' + result;
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
