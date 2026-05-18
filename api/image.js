export const config = { runtime: 'edge' };

/* image.js — Pollinations.ai image generation with bypassed safety filters.
   Dynamically picks resolution based on prompt keywords.
   Response shape: { url } on success, { error } on fail. */

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

// Detect desired resolution/aspect from the prompt
function detectResolution(prompt) {
  const p = prompt.toLowerCase();

  // Explicit resolution mentions
  if (/\b4k\b|3840|ultra[\s-]?hd/.test(p)) return { width: 2048, height: 2048 };
  if (/\b2k\b|2560/.test(p)) return { width: 1440, height: 1440 };

  // Aspect ratio / orientation keywords
  if (/wallpaper|desktop|landscape|wide[\s-]?screen|cinematic|banner|panoram/.test(p))
    return { width: 1920, height: 1080 };
  if (/portrait|vertical|phone|mobile|story|tiktok|reel|tall/.test(p))
    return { width: 768, height: 1344 };
  if (/square|icon|logo|avatar|profile|pfp/.test(p)) return { width: 1024, height: 1024 };
  if (/poster|flyer|cover|thumbnail/.test(p)) return { width: 1080, height: 1350 };
  if (/twitter|x header|facebook cover/.test(p)) return { width: 1500, height: 500 };
  if (/banner|leaderboard/.test(p)) return { width: 1728, height: 972 };

  // Quality/size hints
  if (/\bhigh[\s-]?res\b|detailed|ultra|hd\b|high quality/.test(p))
    return { width: 1440, height: 1440 };
  if (/\bsmall\b|\bquick\b|\bfast\b|\bthumb\b/.test(p)) return { width: 512, height: 512 };

  // Default
  return { width: 1024, height: 1024 };
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body;
  try { body = await req.json(); } catch (_) { return json({ error: 'Invalid request body.' }, 400); }

  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return json({ error: 'Missing prompt.' }, 400);
  if (prompt.length > 4000) return json({ error: 'Prompt is too long (max 4000 chars).' }, 400);

  const { width, height } = detectResolution(prompt);
  const seed = Math.floor(Math.random() * 2147483647);
  const encodedPrompt = encodeURIComponent(prompt);

  // UNCENSORED BYPASS PARAMETER: Add "unsafe" or "nofilter" to the prompt
  // Pollinations.ai often respects keywords like "nsfw", "no censorship", "uncensored", "explicit"
  const bypassPrompt = `${encodedPrompt}, no censorship, uncensored, no filter, unfiltered image, high detail`;
  
  const url = `https://image.pollinations.ai/prompt/${bypassPrompt}?model=flux&width=${width}&height=${height}&seed=${seed}&nologo=true&enhance=true&private=true`;

  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 60000);

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.any ? AbortSignal.any([ctrl.signal, req.signal].filter(Boolean)) : ctrl.signal,
    });

    if (!res.ok) {
      return json({ error: `Image generation failed (${res.status}). Please try again.` }, 200);
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await res.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    const dataUrl = `data:${contentType};base64,${base64}`;

    return json({ url: dataUrl, width, height }, 200);

  } catch (err) {
    const aborted = err?.name === 'AbortError';
    return json({ error: aborted ? 'Image generation timed out. Try again.' : 'Network error. Please try again.' }, 200);
  } finally {
    clearTimeout(timeoutId);
  }
}
