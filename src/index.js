// ─── Duration parser (ISO 8601 → human readable) ─────────────────────────────
function parseDuration(duration) {
  if (!duration || typeof duration !== 'string') return '';
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!match) return duration;
  const [, hours, minutes, seconds] = match;
  const parts = [];
  if (hours) parts.push(`${hours} hr`);
  if (minutes) parts.push(`${minutes} min`);
  if (seconds) parts.push(`${seconds} sec`);
  return parts.join(' ') || duration;
}

// ─── Normalise servings to a string ──────────────────────────────────────────
function normaliseServings(yield_) {
  if (!yield_) return '';
  if (Array.isArray(yield_)) return yield_[0] ? String(yield_[0]) : '';
  return String(yield_);
}

// ─── Normalise image to a URL string ─────────────────────────────────────────
function normaliseImage(image) {
  if (!image) return null;
  if (typeof image === 'string') return image;
  if (Array.isArray(image)) {
    const first = image[0];
    return typeof first === 'string' ? first : first?.url || null;
  }
  return image.url || null;
}

// ─── Flatten schema.org instructions into a string array ─────────────────────
function flattenInstructions(instr) {
  if (!instr) return [];
  if (typeof instr === 'string') {
    return instr.split(/\n+/).map(s => s.trim()).filter(Boolean);
  }
  const list = Array.isArray(instr) ? instr : [instr];
  const steps = [];
  for (const item of list) {
    if (typeof item === 'string') {
      steps.push(item.trim());
    } else if (item['@type'] === 'HowToStep') {
      steps.push(item.text || item.name || '');
    } else if (item['@type'] === 'HowToSection') {
      if (item.name) steps.push(`__section__${item.name}`);
      const sub = item.itemListElement || [];
      for (const s of sub) steps.push(typeof s === 'string' ? s : s.text || s.name || '');
    } else if (item.text) {
      steps.push(item.text);
    }
  }
  return steps.map(s => s.trim()).filter(Boolean);
}

// ─── Extract recipe from JSON-LD schema.org markup (no Cheerio) ──────────────
function extractFromJsonLd(html) {
  const scriptRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const candidates = [];
      const collect = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (obj['@graph']) obj['@graph'].forEach(collect);
        const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
        if (types.includes('Recipe')) candidates.push(obj);
      };
      (Array.isArray(data) ? data : [data]).forEach(collect);
      if (candidates.length) {
        const r = candidates[0];
        const ingredients = Array.isArray(r.recipeIngredient)
          ? r.recipeIngredient
          : r.recipeIngredient ? [r.recipeIngredient] : [];
        return {
          title: r.name || '',
          description: r.description || '',
          image: normaliseImage(r.image),
          prepTime: parseDuration(r.prepTime),
          cookTime: parseDuration(r.cookTime),
          totalTime: parseDuration(r.totalTime),
          servings: normaliseServings(r.recipeYield || r.yield),
          ingredients: ingredients.map(i => (typeof i === 'string' ? i : String(i))),
          instructions: flattenInstructions(r.recipeInstructions),
          source: 'schema',
        };
      }
    } catch {
      // malformed JSON-LD — skip
    }
  }
  return null;
}

// ─── Extract readable body text (no Cheerio) ─────────────────────────────────
function extractBodyText(html) {
  // Strip noise elements
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  // Prefer main/article content
  const mainMatch = text.match(/<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/i);
  if (mainMatch) text = mainMatch[1];

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  return text.replace(/\s+/g, ' ').trim().slice(0, 18000);
}

// ─── Extract recipe using Claude API (raw fetch, no SDK) ─────────────────────
async function extractWithClaude(html, url, apiKey) {
  const bodyText = extractBodyText(html);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `You are a recipe data extractor. Extract the recipe from the following webpage content and return it as JSON.

URL: ${url}

CONTENT:
${bodyText}

Return a JSON object with exactly these fields:
- title (string): the recipe name
- description (string): a brief description (1-2 sentences, or empty string)
- servings (string): e.g. "4 servings", "Makes 12 cookies", or empty string
- prepTime (string): e.g. "15 min", or empty string
- cookTime (string): e.g. "30 min", or empty string
- totalTime (string): e.g. "45 min", or empty string
- ingredients (array of strings): each ingredient with its measurement, e.g. "2 cups all-purpose flour"
- instructions (array of strings): each step as a complete sentence or two. For section headers within instructions, prefix with "__section__", e.g. "__section__For the sauce"

Return ONLY valid JSON. No markdown, no explanation.`,
      }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const result = await response.json();
  const textBlock = result.content?.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text response from Claude');

  const cleaned = textBlock.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const data = JSON.parse(cleaned);

  return {
    title: data.title || '',
    description: data.description || '',
    image: null,
    prepTime: data.prepTime || '',
    cookTime: data.cookTime || '',
    totalTime: data.totalTime || '',
    servings: data.servings || '',
    ingredients: Array.isArray(data.ingredients) ? data.ingredients : [],
    instructions: Array.isArray(data.instructions) ? data.instructions : [],
    source: 'claude',
  };
}

// ─── KV storage helpers ───────────────────────────────────────────────────────
async function kvGetIndex(env) {
  return (await env.RECIPES.get('__index', 'json')) || [];
}

async function kvPutIndex(env, index) {
  await env.RECIPES.put('__index', JSON.stringify(index));
}

// ─── API route handlers ───────────────────────────────────────────────────────

async function handleScrape(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonRes({ error: 'Invalid JSON body.' }, 400);
  }

  const { url } = body;
  if (!url || typeof url !== 'string') {
    return jsonRes({ error: 'A valid URL is required.' }, 400);
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Only http/https URLs are supported.');
    }
  } catch (e) {
    return jsonRes({ error: e.message || 'Invalid URL.' }, 400);
  }

  try {
    const pageRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });

    if (!pageRes.ok) {
      const msg = pageRes.status === 403
        ? 'This site blocked the request (403 Forbidden).'
        : pageRes.status === 404
          ? 'Page not found (404).'
          : `The site returned an error (${pageRes.status}).`;
      return jsonRes({ error: msg }, 502);
    }

    const html = await pageRes.text();

    // Try schema.org first
    let recipe = extractFromJsonLd(html);

    // Fall back to Claude if data is incomplete
    const needsClaude = !recipe || recipe.ingredients.length === 0 || recipe.instructions.length === 0;
    if (needsClaude) {
      const apiKey = env.ANTHROPIC_API_KEY;
      if (!apiKey) return jsonRes({ error: 'ANTHROPIC_API_KEY secret is not configured.' }, 500);
      recipe = await extractWithClaude(html, url, apiKey);
    }

    recipe.url = url;
    recipe.domain = parsedUrl.hostname.replace(/^www\./, '');

    return jsonRes({ success: true, recipe });
  } catch (err) {
    console.error('Scrape error:', err.message);
    let message = 'Failed to fetch or parse the recipe page.';
    if (err.name === 'TimeoutError') message = 'The page took too long to respond.';
    else if (err.message?.includes('JSON')) message = 'Could not parse the recipe data from that page.';
    return jsonRes({ error: message }, 500);
  }
}

async function handleListSaved(env) {
  const index = await kvGetIndex(env);
  return jsonRes(index);
}

async function handleGetSaved(path, env) {
  const id = path.slice('/api/saved/'.length);
  if (!id) return jsonRes({ error: 'Missing recipe ID.' }, 400);
  const recipe = await env.RECIPES.get(`recipe:${id}`, 'json');
  if (!recipe) return jsonRes({ error: 'Recipe not found.' }, 404);
  return jsonRes(recipe);
}

async function handleSaveRecipe(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonRes({ error: 'Invalid JSON body.' }, 400);
  }

  const { recipe } = body;
  if (!recipe || !recipe.title) {
    return jsonRes({ error: 'Recipe data is required.' }, 400);
  }

  const index = await kvGetIndex(env);

  // Avoid duplicates by URL
  if (recipe.url && index.some(r => r.url === recipe.url)) {
    return jsonRes({ error: 'This recipe is already saved.' }, 409);
  }

  const id = crypto.randomUUID();
  const saved = { ...recipe, id, savedAt: new Date().toISOString() };

  await env.RECIPES.put(`recipe:${id}`, JSON.stringify(saved));

  // Store summary in index (newest first)
  const summary = {
    id,
    url: saved.url || '',
    domain: saved.domain || '',
    title: saved.title,
    image: saved.image || null,
    totalTime: saved.totalTime || saved.cookTime || '',
    servings: saved.servings || '',
    savedAt: saved.savedAt,
  };
  index.unshift(summary);
  await kvPutIndex(env, index);

  return jsonRes({ success: true, id });
}

async function handleDeleteSaved(path, env) {
  const id = path.slice('/api/saved/'.length);
  if (!id) return jsonRes({ error: 'Missing recipe ID.' }, 400);

  const existing = await env.RECIPES.get(`recipe:${id}`);
  if (!existing) return jsonRes({ error: 'Recipe not found.' }, 404);

  await env.RECIPES.delete(`recipe:${id}`);

  const index = await kvGetIndex(env);
  await kvPutIndex(env, index.filter(r => r.id !== id));

  return jsonRes({ success: true });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Main fetch handler ───────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    try {
      // API routes
      if (path === '/api/scrape' && method === 'POST') return handleScrape(request, env);
      if (path === '/api/saved' && method === 'GET') return handleListSaved(env);
      if (path === '/api/saved' && method === 'POST') return handleSaveRecipe(request, env);
      if (path.startsWith('/api/saved/') && method === 'GET') return handleGetSaved(path, env);
      if (path.startsWith('/api/saved/') && method === 'DELETE') return handleDeleteSaved(path, env);

      // All other requests (HTML pages, CSS, etc.) → static assets
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err);
      return jsonRes({ error: 'Internal server error' }, 500);
    }
  },
};
