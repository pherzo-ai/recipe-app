import { type NextRequest } from 'next/server';

// ─── Duration parser ──────────────────────────────────────────────────────────
function parseDuration(duration: string | undefined): string {
  if (!duration || typeof duration !== 'string') return '';
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!match) return duration;
  const [, hours, minutes, seconds] = match;
  const parts: string[] = [];
  if (hours) parts.push(`${hours} hr`);
  if (minutes) parts.push(`${minutes} min`);
  if (seconds) parts.push(`${seconds} sec`);
  return parts.join(' ') || duration;
}

function normaliseServings(yield_: unknown): string {
  if (!yield_) return '';
  if (Array.isArray(yield_)) return yield_[0] ? String(yield_[0]) : '';
  return String(yield_);
}

function normaliseImage(image: unknown): string | null {
  if (!image) return null;
  if (typeof image === 'string') return image;
  if (Array.isArray(image)) {
    const first = image[0];
    return typeof first === 'string' ? first : (first as { url?: string })?.url || null;
  }
  return (image as { url?: string }).url || null;
}

function flattenInstructions(instr: unknown): string[] {
  if (!instr) return [];
  if (typeof instr === 'string') {
    return instr.split(/\n+/).map(s => s.trim()).filter(Boolean);
  }
  const list = Array.isArray(instr) ? instr : [instr];
  const steps: string[] = [];
  for (const item of list as Record<string, unknown>[]) {
    if (typeof item === 'string') {
      steps.push((item as string).trim());
    } else if (item['@type'] === 'HowToStep') {
      steps.push(String(item.text || item.name || ''));
    } else if (item['@type'] === 'HowToSection') {
      if (item.name) steps.push(`__section__${item.name}`);
      const sub = (item.itemListElement as unknown[] | undefined) || [];
      for (const s of sub) {
        steps.push(typeof s === 'string' ? s : String((s as Record<string, unknown>).text || (s as Record<string, unknown>).name || ''));
      }
    } else if (item.text) {
      steps.push(String(item.text));
    }
  }
  return steps.map(s => s.trim()).filter(Boolean);
}

function extractFromJsonLd(html: string) {
  const scriptRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const candidates: Record<string, unknown>[] = [];
      const collect = (obj: unknown) => {
        if (!obj || typeof obj !== 'object') return;
        const o = obj as Record<string, unknown>;
        if (o['@graph']) (o['@graph'] as unknown[]).forEach(collect);
        const types = Array.isArray(o['@type']) ? o['@type'] : [o['@type']];
        if (types.includes('Recipe')) candidates.push(o);
      };
      (Array.isArray(data) ? data : [data]).forEach(collect);
      if (candidates.length) {
        const r = candidates[0];
        const ingredients = Array.isArray(r.recipeIngredient)
          ? r.recipeIngredient as string[]
          : r.recipeIngredient ? [String(r.recipeIngredient)] : [];
        return {
          title: String(r.name || ''),
          description: String(r.description || ''),
          image: normaliseImage(r.image),
          prepTime: parseDuration(r.prepTime as string | undefined),
          cookTime: parseDuration(r.cookTime as string | undefined),
          totalTime: parseDuration(r.totalTime as string | undefined),
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

function extractBodyText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  const mainMatch = text.match(/<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/i);
  if (mainMatch) text = mainMatch[1];

  text = text.replace(/<[^>]+>/g, ' ');
  return text.replace(/\s+/g, ' ').trim().slice(0, 18000);
}

async function extractWithClaude(html: string, url: string, apiKey: string) {
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
- ingredients (array of strings): each ingredient with its measurement
- instructions (array of strings): each step as a complete sentence or two. For section headers prefix with "__section__"

Return ONLY valid JSON. No markdown, no explanation.`,
      }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const result = await response.json() as { content: Array<{ type: string; text: string }> };
  const textBlock = result.content?.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text response from Claude');

  const cleaned = textBlock.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const data = JSON.parse(cleaned) as {
    title?: string; description?: string; servings?: string;
    prepTime?: string; cookTime?: string; totalTime?: string;
    ingredients?: string[]; instructions?: string[];
  };

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

export async function POST(request: NextRequest) {
  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { url } = body;
  if (!url || typeof url !== 'string') {
    return Response.json({ error: 'A valid URL is required.' }, { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Only http/https URLs are supported.');
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message || 'Invalid URL.' }, { status: 400 });
  }

  try {
    const pageRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });

    if (!pageRes.ok) {
      const msg =
        pageRes.status === 403 ? 'This site blocked the request (403 Forbidden).' :
        pageRes.status === 404 ? 'Page not found (404).' :
        `The site returned an error (${pageRes.status}).`;
      return Response.json({ error: msg }, { status: 502 });
    }

    const html = await pageRes.text();

    let recipe = extractFromJsonLd(html);

    const needsClaude = !recipe || recipe.ingredients.length === 0 || recipe.instructions.length === 0;
    if (needsClaude) {
      // Get ANTHROPIC_API_KEY from Cloudflare env
      let apiKey: string | undefined;
      try {
        const { getCloudflareContext } = await import('@opennextjs/cloudflare');
        const ctx = await getCloudflareContext();
        apiKey = (ctx.env as CloudflareEnv).ANTHROPIC_API_KEY;
      } catch {
        apiKey = process.env.ANTHROPIC_API_KEY;
      }
      if (!apiKey) {
        return Response.json({ error: 'ANTHROPIC_API_KEY secret is not configured.' }, { status: 500 });
      }
      recipe = await extractWithClaude(html, url, apiKey);
    }

    const result = {
      ...recipe!,
      url,
      domain: parsedUrl.hostname.replace(/^www\./, ''),
    };

    return Response.json({ success: true, recipe: result });
  } catch (err) {
    console.error('Scrape error:', (err as Error).message);
    let message = 'Failed to fetch or parse the recipe page.';
    if ((err as Error).name === 'TimeoutError') message = 'The page took too long to respond.';
    else if ((err as Error).message?.includes('JSON')) message = 'Could not parse the recipe data from that page.';
    return Response.json({ error: message }, { status: 500 });
  }
}
