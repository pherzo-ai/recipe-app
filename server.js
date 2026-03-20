const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const client = new Anthropic();

// ─── Data storage setup ───────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const RECIPES_FILE = path.join(DATA_DIR, 'recipes.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(RECIPES_FILE)) {
  fs.writeFileSync(RECIPES_FILE, JSON.stringify([], null, 2));
}

function readRecipes() {
  try {
    return JSON.parse(fs.readFileSync(RECIPES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeRecipes(recipes) {
  fs.writeFileSync(RECIPES_FILE, JSON.stringify(recipes, null, 2));
}

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
  if (Array.isArray(yield_)) {
    return yield_[0] ? String(yield_[0]) : '';
  }
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
      for (const s of sub) {
        steps.push(typeof s === 'string' ? s : s.text || s.name || '');
      }
    } else if (item.text) {
      steps.push(item.text);
    }
  }
  return steps.map(s => s.trim()).filter(Boolean);
}

// ─── Extract recipe from JSON-LD schema.org markup ───────────────────────────
function extractFromJsonLd(html) {
  const $ = cheerio.load(html);
  let schemaRecipe = null;

  $('script[type="application/ld+json"]').each((_, el) => {
    if (schemaRecipe) return;
    try {
      const raw = $(el).html();
      if (!raw) return;
      const data = JSON.parse(raw);
      const candidates = [];
      const collect = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (obj['@graph']) obj['@graph'].forEach(collect);
        const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
        if (types.includes('Recipe')) candidates.push(obj);
      };
      (Array.isArray(data) ? data : [data]).forEach(collect);
      if (candidates.length) schemaRecipe = candidates[0];
    } catch {
      // malformed JSON-LD — skip
    }
  });

  if (!schemaRecipe) return null;

  const ingredients = Array.isArray(schemaRecipe.recipeIngredient)
    ? schemaRecipe.recipeIngredient
    : schemaRecipe.recipeIngredient
      ? [schemaRecipe.recipeIngredient]
      : [];

  const instructions = flattenInstructions(schemaRecipe.recipeInstructions);

  return {
    title: schemaRecipe.name || '',
    description: schemaRecipe.description || '',
    image: normaliseImage(schemaRecipe.image),
    prepTime: parseDuration(schemaRecipe.prepTime),
    cookTime: parseDuration(schemaRecipe.cookTime),
    totalTime: parseDuration(schemaRecipe.totalTime),
    servings: normaliseServings(schemaRecipe.recipeYield || schemaRecipe.yield),
    ingredients: ingredients.map(i => (typeof i === 'string' ? i : String(i))),
    instructions,
    source: 'schema',
  };
}

// ─── Extract recipe using Claude API ─────────────────────────────────────────
async function extractWithClaude(html, url) {
  const $ = cheerio.load(html);

  // Strip noise
  $('script, style, nav, footer, header, aside, iframe, noscript').remove();
  $('[class*="sidebar"], [class*="ad-"], [id*="ad-"], [class*="popup"], [class*="modal"]').remove();
  $('[class*="comment"], [class*="social"], [class*="share"], [class*="related"]').remove();

  // Prefer main/article content
  const mainEl = $('main, article, [role="main"]').first();
  const bodyText = (mainEl.length ? mainEl : $('body'))
    .text()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 18000);

  const response = await client.messages.create({
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

Return ONLY valid JSON. No markdown, no explanation.`
    }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text response from Claude');

  // Strip any accidental markdown code fences
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

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST /api/scrape
app.post('/api/scrape', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'A valid URL is required.' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Only http/https URLs are supported.');
    }
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Invalid URL.' });
  }

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
      timeout: 20000,
      maxRedirects: 5,
      responseType: 'text',
    });

    const html = response.data;

    // Try schema.org first
    let recipe = extractFromJsonLd(html);

    // If schema.org extraction is missing key data, fall back to Claude
    const needsClaude = !recipe ||
      recipe.ingredients.length === 0 ||
      recipe.instructions.length === 0;

    if (needsClaude) {
      recipe = await extractWithClaude(html, url);
    }

    recipe.url = url;
    recipe.domain = parsedUrl.hostname.replace(/^www\./, '');

    res.json({ success: true, recipe });
  } catch (err) {
    console.error('Scrape error:', err.message);
    let message = 'Failed to fetch or parse the recipe page.';
    if (axios.isAxiosError(err)) {
      if (err.code === 'ECONNABORTED') message = 'The page took too long to respond.';
      else if (err.response?.status === 403) message = 'This site blocked the request (403 Forbidden).';
      else if (err.response?.status === 404) message = 'Page not found (404).';
      else if (err.response?.status) message = `The site returned an error (${err.response.status}).`;
    } else if (err.message.includes('JSON')) {
      message = 'Could not parse the recipe data from that page.';
    }
    res.status(500).json({ error: message });
  }
});

// GET /api/saved
app.get('/api/saved', (req, res) => {
  res.json(readRecipes());
});

// GET /api/saved/:id
app.get('/api/saved/:id', (req, res) => {
  const recipes = readRecipes();
  const recipe = recipes.find(r => r.id === req.params.id);
  if (!recipe) return res.status(404).json({ error: 'Recipe not found.' });
  res.json(recipe);
});

// POST /api/save
app.post('/api/save', (req, res) => {
  const { recipe } = req.body;
  if (!recipe || !recipe.title) {
    return res.status(400).json({ error: 'Recipe data is required.' });
  }

  const recipes = readRecipes();

  // Avoid duplicates by URL
  if (recipe.url && recipes.some(r => r.url === recipe.url)) {
    return res.status(409).json({ error: 'This recipe is already saved.' });
  }

  const saved = {
    ...recipe,
    id: uuidv4(),
    savedAt: new Date().toISOString(),
  };

  recipes.unshift(saved); // newest first
  writeRecipes(recipes);
  res.json({ success: true, id: saved.id });
});

// DELETE /api/saved/:id
app.delete('/api/saved/:id', (req, res) => {
  let recipes = readRecipes();
  const before = recipes.length;
  recipes = recipes.filter(r => r.id !== req.params.id);
  if (recipes.length === before) {
    return res.status(404).json({ error: 'Recipe not found.' });
  }
  writeRecipes(recipes);
  res.json({ success: true });
});

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  Recipe App running at http://localhost:${PORT}\n`);
});
