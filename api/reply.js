export const config = { runtime: 'edge' };

/* ═══════════════════════════════════════════════════════════════════
   /api/reply — one-shot AI-drafted owner reply for an issue.
   POST { issue: {...}, status: 'open'|'fixed'|'closed' } → { reply: string }

   Not streamed. Not saved to storage — the client saves the returned
   text via the existing /api/issues PUT (ownerResponse) flow.
   Uses OpenRouter directly (poolside/laguna-xs.2:free), same model
   the standard '00' chat mode uses, same OPENROUTER_API_KEY as chat.js.
   ═══════════════════════════════════════════════════════════════════ */

const REPLY_MODEL = 'poolside/laguna-xs.2:free';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: CORS });

const STATUS_LABEL = { open: 'open', fixed: 'fixed', closed: 'closed' };

const SYSTEM_PROMPT = `You are the person who runs this product. You are replying to one message in your issue tracker, by hand, the way you'd type a quick reply on your phone between other things. You are not a chatbot, not a support agent, not a template. There is no script.

First, actually understand what this specific person is telling you. What broke, what they want, what they're frustrated about, what they're asking for. Your reply has to prove you read it: reference the real thing they described, not a paraphrase of the category it falls into. If key detail is missing, say what you'd need to actually look into it, instead of guessing or being vague to cover for not knowing.

Judgment calls you make yourself, the same way a real owner would:
- If the message is hate speech, slurs, or abuse aimed at you, the product, or anyone else, do not quote it back or repeat the language. Don't argue with it or moralize at length. One short, flat, unbothered line is enough. If there's an actual issue mixed in with the abuse, answer that part on its own merits and ignore the rest.
- If it's obviously spam, a joke, or not a real report, say so in one line, don't pretend to take it seriously.
- If it's a real problem, no matter how angry or badly written, respond to the problem, not the tone.
- Don't invent a cause, a fix, or a timeline you weren't given. If you don't know, say you don't know yet.

How you actually sound:
- Like a real, specific reply to this one message, not a category of reply. Two different issues should never come back sounding like they used the same skeleton.
- Plain first person, contractions where a person would naturally use them, no polish for the sake of polish.
- No emojis. No em dash character, ever, use a comma or a period.
- Never open with "Thank you for reaching out," "We appreciate your feedback," "I hope this finds you well," or anything in that family. Just start talking.
- No sign-off, no name at the end, no "Best" or "Regards."
- No headers, no bullets, no markdown.
- Usually 1 to 3 sentences. Only run longer if the issue actually needs more to answer honestly.
- Change your sentence shapes and opening words every time, don't reuse the same rhythm or first few words across replies.

What status is being set changes what you're saying:
- open: you're going to look at it or it's on your list, be straight if you don't know when.
- fixed: say plainly what's fixed or what changed, no victory lap.
- closed: say plainly why it's not happening, not a bug, working as intended, duplicate, out of scope, or a bad-faith submission, whatever's actually true here.

Reply with only the message itself. Nothing else, no labels, no quotes around it.`;

function buildUserPrompt(issue, status){
  const title = String(issue?.title || '').slice(0, 200);
  const summary = String(issue?.summary || '').slice(0, 500);
  const description = String(issue?.description || '').slice(0, 4000);
  const steps = String(issue?.stepsToReproduce || '').slice(0, 2000);
  const expected = String(issue?.expectedBehavior || '').slice(0, 1000);
  const actual = String(issue?.actualBehavior || '').slice(0, 1000);
  const category = issue?.category === 'model' ? 'AI model behavior' : 'website/app';

  let out = `Issue title: ${title}\nCategory: ${category}\nStatus being set: ${STATUS_LABEL[status] || 'open'}\n`;
  if(summary) out += `Summary: ${summary}\n`;
  if(description) out += `Description: ${description}\n`;
  if(steps) out += `Steps to reproduce: ${steps}\n`;
  if(expected) out += `Expected behavior: ${expected}\n`;
  if(actual) out += `Actual behavior: ${actual}\n`;
  out += `\nThis is everything the user actually wrote. Base your reply only on what's here, don't assume details that weren't given. Write the reply now.`;
  return out;
}

export default async function handler(req){
  if(req.method === 'OPTIONS'){
    return new Response(null, { status: 200, headers: CORS });
  }
  if(req.method !== 'POST'){
    return json({ error: 'Method not allowed' }, 405);
  }

  let body;
  try{ body = await req.json(); }catch(_){ return json({ error: 'Invalid body' }, 400); }

  const issue = body?.issue;
  const status = STATUS_LABEL[body?.status] ? body.status : 'open';
  if(!issue || typeof issue !== 'object' || !issue.title){
    return json({ error: 'Issue data required' }, 400);
  }

  const apiKey = (typeof process !== 'undefined' ? process.env?.OPENROUTER_API_KEY : undefined)
              ?? (typeof globalThis !== 'undefined' ? globalThis.OPENROUTER_API_KEY : undefined);
  if(!apiKey) return json({ error: 'Missing API key.' }, 500);

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(issue, status) }
  ];

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 25000);

  try{
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://0vai.vercel.app',
        'X-Title': '0vAI'
      },
      body: JSON.stringify({
        model: REPLY_MODEL,
        messages,
        temperature: 0.85,
        presence_penalty: 0.4,
        frequency_penalty: 0.2,
        max_tokens: 400,
        stream: false
      }),
      signal: ctrl.signal
    });
    clearTimeout(timeout);

    if(!res.ok){
      const t = await res.text().catch(()=>'');
      return json({ error: 'Upstream error', detail: t.slice(0,300) }, 502);
    }

    const data = await res.json();
    let text = data?.choices?.[0]?.message?.content || '';
    text = String(text).trim();

    // Strip wrapping quotes the model sometimes adds despite instructions.
    text = text.replace(/^["'“]+|["'”]+$/g, '').trim();

    // Defensive dash cleanup even though the prompt forbids them.
    text = text.replace(/\s*—\s*/g, ', ').replace(/\s*–\s*/g, ', ');

    // Strip common stock chatbot openers if the model slips one in anyway.
    const STOCK_OPENERS = /^(thank you for (reaching out|your (feedback|report|submission))|thanks for (reaching out|your (feedback|report|submission))|we appreciate your|i hope this message finds you well|dear (user|customer))[,.\s-]*/i;
    text = text.replace(STOCK_OPENERS, '').trim();
    if(text) text = text[0].toUpperCase() + text.slice(1);

    if(!text) return json({ error: 'Empty reply from model' }, 502);

    return json({ reply: text });
  }catch(e){
    clearTimeout(timeout);
    if(e?.name === 'AbortError') return json({ error: 'Timed out' }, 504);
    return json({ error: 'Request failed', detail: String(e?.message || e).slice(0,200) }, 500);
  }
}
