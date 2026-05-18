export const config = { runtime: 'edge' };

/* search.js — Tavily → Wikipedia → DuckDuckGo fallback chain.
   Response: { results:[{title,url,snippet,score?}], answer:string|null, source:string } */

const PROVIDER_TIMEOUT_MS = 8000;
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=60',
  },
});

function withTimeout(ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(id) };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body; try { body = await req.json(); } catch (_) { return json({ error: 'Invalid body' }, 400); }
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  if (!query) return json({ error: 'No query' }, 400);

  const apiKey = (typeof process !== 'undefined' ? process.env?.TAVILY_API_KEY : undefined)
              ?? (typeof globalThis !== 'undefined' ? globalThis.TAVILY_API_KEY : undefined);

  if (apiKey) {
    const r = await tryTavily(query, apiKey);
    if (r) return json(r);
  }
  const wiki = await tryWikipediaDeep(query);
  if (wiki) return json(wiki);
  const ddg = await tryDDG(query);
  if (ddg) return json(ddg);

  return json({ results: [], answer: null, source: 'none' });
}

async function tryTavily(query, apiKey) {
  const t = withTimeout(PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        query,
        search_depth: 'advanced',
        include_answer: true,
        include_raw_content: false,
        max_results: 6,
      }),
      signal: t.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const results = (data.results || []).map(r => ({
      title:   r.title   || '',
      url:     r.url     || '',
      snippet: r.content || '',
      score:   r.score   || 0,
    }));
    return { results, answer: data.answer || null, source: 'tavily' };
  } catch (_) { return null; }
  finally { t.done(); }
}

async function tryWikipediaDeep(query) {
  const t = withTimeout(PROVIDER_TIMEOUT_MS);
  try {
    const searchUrl = 'https://en.wikipedia.org/w/api.php?' + new URLSearchParams({
      action:'query', list:'search', srsearch:query, format:'json', srlimit:'5',
      srprop:'snippet|titlesnippet', origin:'*',
    });
    const sRes = await fetch(searchUrl, { headers: { 'User-Agent': '0v-AI/1.0' }, signal: t.signal });
    const sData = await sRes.json();
    const hits = sData?.query?.search || [];
    if (!hits.length) return null;

    const results = await Promise.all(hits.slice(0, 4).map(async hit => {
      try {
        const eUrl = 'https://en.wikipedia.org/w/api.php?' + new URLSearchParams({
          action:'query', prop:'extracts|info', exintro:'true', explaintext:'true',
          exsectionformat:'plain', titles:hit.title, format:'json', inprop:'url', origin:'*',
        });
        const eRes = await fetch(eUrl, { headers: { 'User-Agent': '0v-AI/1.0' }, signal: t.signal });
        const eData = await eRes.json();
        const page = Object.values(eData?.query?.pages || {})[0];
        if (!page?.extract || page.extract.length <= 50) return null;
        return {
          title: page.title,
          url: page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g,'_'))}`,
          snippet: page.extract.replace(/\n{2,}/g,'\n').trim().slice(0, 600),
        };
      } catch (_) { return null; }
    }));
    const filtered = results.filter(Boolean);
    return filtered.length ? { results: filtered, answer: null, source: 'wikipedia' } : null;
  } catch (_) { return null; }
  finally { t.done(); }
}

async function tryDDG(query) {
  const t = withTimeout(PROVIDER_TIMEOUT_MS);
  try {
    const url = 'https://api.duckduckgo.com/?' + new URLSearchParams({
      q: query, format:'json', no_redirect:'1', no_html:'1', skip_disambig:'1',
    });
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 0v-AI/1.0' }, signal: t.signal });
    const data = await r.json();
    const results = [];
    const answer = data.Answer || null;

    if (data.AbstractText && data.AbstractText.length > 30) {
      results.push({
        title:   data.Heading || query,
        url:     data.AbstractURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
        snippet: data.AbstractText.slice(0, 500),
      });
    }
    for (const topic of (data.RelatedTopics || [])) {
      if (results.length >= 4) break;
      if (topic.Text && topic.Text.length > 20 && topic.FirstURL) {
        results.push({
          title:   topic.Text.split(' - ')[0].slice(0, 80),
          url:     topic.FirstURL,
          snippet: topic.Text.slice(0, 300),
        });
      }
    }
    return (results.length || answer) ? { results, answer, source: 'ddg' } : null;
  } catch (_) { return null; }
  finally { t.done(); }
}
