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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return Response.json({ error: 'Missing recipe ID.' }, { status: 400 });

  const kv = await getKv();
  if (!kv) {
    return Response.json({ error: 'Storage not available in this environment.' }, { status: 503 });
  }

  const recipe = await kv.get(`recipe:${id}`, 'json');
  if (!recipe) return Response.json({ error: 'Recipe not found.' }, { status: 404 });

  return Response.json(recipe);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return Response.json({ error: 'Missing recipe ID.' }, { status: 400 });

  const kv = await getKv();
  if (!kv) {
    return Response.json({ error: 'Storage not available in this environment.' }, { status: 503 });
  }

  const existing = await kv.get(`recipe:${id}`);
  if (!existing) return Response.json({ error: 'Recipe not found.' }, { status: 404 });

  await kv.delete(`recipe:${id}`);

  const index = await kvGetIndex(kv) as Array<Record<string, unknown>>;
  await kvPutIndex(kv, index.filter((r) => r.id !== id));

  return Response.json({ success: true });
}
