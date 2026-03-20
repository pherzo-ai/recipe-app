import { type NextRequest } from 'next/server';

async function getKv(): Promise<KVNamespace | null> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const ctx = await getCloudflareContext();
    return (ctx.env as CloudflareEnv).RECIPES ?? null;
  } catch {
    return null;
  }
}

async function kvGetIndex(kv: KVNamespace) {
  return (await kv.get('__index', 'json') as unknown[] | null) || [];
}

async function kvPutIndex(kv: KVNamespace, index: unknown[]) {
  await kv.put('__index', JSON.stringify(index));
}

export async function GET() {
  const kv = await getKv();
  if (!kv) {
    return Response.json({ error: 'Storage not available in this environment.' }, { status: 503 });
  }
  const index = await kvGetIndex(kv);
  return Response.json(index);
}

export async function POST(request: NextRequest) {
  const kv = await getKv();
  if (!kv) {
    return Response.json({ error: 'Storage not available in this environment.' }, { status: 503 });
  }

  let body: { recipe?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { recipe } = body;
  if (!recipe || !recipe.title) {
    return Response.json({ error: 'Recipe data is required.' }, { status: 400 });
  }

  const index = await kvGetIndex(kv) as Array<Record<string, unknown>>;

  if (recipe.url && index.some(r => r.url === recipe.url)) {
    return Response.json({ error: 'This recipe is already saved.' }, { status: 409 });
  }

  const id = crypto.randomUUID();
  const saved = { ...recipe, id, savedAt: new Date().toISOString() } as Record<string, unknown> & { id: string; savedAt: string };

  await kv.put(`recipe:${id}`, JSON.stringify(saved));

  const summary = {
    id,
    url: (saved.url as string) || '',
    domain: (saved.domain as string) || '',
    title: saved.title as string,
    image: (saved.image as string | null) || null,
    totalTime: (saved.totalTime as string) || (saved.cookTime as string) || '',
    servings: (saved.servings as string) || '',
    savedAt: saved.savedAt,
  };
  index.unshift(summary);
  await kvPutIndex(kv, index);

  return Response.json({ success: true, id });
}
