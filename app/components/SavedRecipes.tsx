'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Toast, { ToastHandle } from './Toast';
import LoadingOverlay from './LoadingOverlay';

const API_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface RecipeSummary {
  id: string;
  url: string;
  domain: string;
  title: string;
  image: string | null;
  totalTime: string;
  cookTime?: string;
  servings: string;
  savedAt: string;
}

function formatDate(iso: string) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));
  } catch { return ''; }
}

function RecipeCard({
  recipe,
  onDelete,
}: {
  recipe: RecipeSummary;
  onDelete: (id: string, title: string) => void;
}) {
  const [imgError, setImgError] = useState(false);
  const meta: string[] = [];
  const time = recipe.totalTime || recipe.cookTime;
  if (time) meta.push(`⏱ ${time}`);
  if (recipe.servings) meta.push(`🍽 ${recipe.servings}`);

  return (
    <article className="recipe-card" data-id={recipe.id}>
      {recipe.image && !imgError ? (
        <img
          src={recipe.image}
          alt=""
          className="card-thumb"
          loading="lazy"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className="card-thumb-placeholder" aria-hidden="true">🍴</div>
      )}
      <div className="card-body">
        <h2 className="card-title">{recipe.title || 'Untitled Recipe'}</h2>
        {meta.length > 0 && (
          <div className="card-meta">
            {meta.map((m, i) => <span key={i}>{m}</span>)}
          </div>
        )}
        {recipe.savedAt && (
          <p className="card-domain">
            Saved {formatDate(recipe.savedAt)}
            {recipe.domain ? ` · ${recipe.domain}` : ''}
          </p>
        )}
      </div>
      <div className="card-actions">
        <Link href={`/recipe?id=${encodeURIComponent(recipe.id)}`} className="btn btn-outline">
          View
        </Link>
        <button
          className="btn btn-danger"
          onClick={() => onDelete(recipe.id, recipe.title)}
        >
          Remove
        </button>
      </div>
    </article>
  );
}

export default function SavedRecipes() {
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const toastRef = useRef<ToastHandle>(null);

  async function load() {
    setLoading(true);
    setFetchError('');
    try {
      const res = await fetch(`${API_BASE}/api/saved`);
      if (!res.ok) throw new Error('Could not load saved recipes.');
      setRecipes(await res.json());
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(id: string, title: string) {
    if (!confirm(`Remove "${title || 'this recipe'}" from your saved recipes?`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/saved/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || 'Could not remove recipe.');
      }
      setRecipes(prev => {
        const updated = prev.filter(r => r.id !== id);
        return updated;
      });
      toastRef.current?.show('Recipe removed.');
    } catch (err) {
      toastRef.current?.show(err instanceof Error ? err.message : 'Could not remove.', 'error');
    }
  }

  return (
    <>
      <div className="saved-header" id="savedHeader">
        <div>
          <h1 className="saved-title">Saved Recipes</h1>
          {!loading && recipes.length > 0 && (
            <p className="saved-count">
              {recipes.length} recipe{recipes.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <Link href="/" className="btn btn-primary">+ Add Recipe</Link>
      </div>

      {!loading && fetchError && (
        <div className="empty-state">
          <div className="empty-state-icon">⚠️</div>
          <h2>Couldn&apos;t load recipes</h2>
          <p>{fetchError}</p>
          <button className="btn btn-outline" onClick={load}>Try again</button>
        </div>
      )}

      {!loading && !fetchError && recipes.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">📭</div>
          <h2>No saved recipes yet</h2>
          <p>
            Head back to the home page, paste a recipe URL, and hit &quot;Save Recipe&quot; to
            build your collection.
          </p>
          <Link href="/" className="btn btn-primary">Find a Recipe</Link>
        </div>
      )}

      {!loading && !fetchError && recipes.length > 0 && (
        <div className="saved-grid">
          {recipes.map(r => (
            <RecipeCard key={r.id} recipe={r} onDelete={handleDelete} />
          ))}
        </div>
      )}

      <LoadingOverlay visible={loading} message="Loading saved recipes…" />
      <Toast ref={toastRef} />
    </>
  );
}
