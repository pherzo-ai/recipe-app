'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import LoadingOverlay from './LoadingOverlay';
import Toast, { ToastHandle } from './Toast';

const API_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Recipe {
  id?: string;
  title: string;
  description?: string;
  image?: string | null;
  prepTime?: string;
  cookTime?: string;
  totalTime?: string;
  servings?: string;
  ingredients: string[];
  instructions: string[];
  url?: string;
  domain?: string;
  source?: string;
  savedAt?: string;
}

function MetaChip({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="meta-chip">
      <span className="meta-chip-label">{label}</span>
      <span className="meta-chip-value">{value}</span>
    </div>
  );
}

function IngredientItem({ text, index }: { text: string; index: number }) {
  const [checked, setChecked] = useState(false);
  return (
    <li
      className={`ingredient-item${checked ? ' checked' : ''}`}
      onClick={() => setChecked(c => !c)}
    >
      <input
        type="checkbox"
        id={`ing-${index}`}
        checked={checked}
        onChange={() => setChecked(c => !c)}
        aria-label={text}
        tabIndex={-1}
      />
      <label className="ingredient-text" htmlFor={`ing-${index}`}>{text}</label>
    </li>
  );
}

export default function RecipeViewer() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const savedId = searchParams.get('id');

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [imgError, setImgError] = useState(false);
  const toastRef = useRef<ToastHandle>(null);

  useEffect(() => {
    async function load() {
      if (savedId) {
        // Load from API by ID
        try {
          const res = await fetch(`${API_BASE}/api/saved/${encodeURIComponent(savedId)}`);
          if (!res.ok) throw new Error('Recipe not found.');
          const data: Recipe = await res.json();
          setRecipe(data);
          setSaveState('saved');
        } catch (err) {
          setRecipe({ title: '', ingredients: [], instructions: [], _error: (err as Error).message } as Recipe & { _error: string });
        }
      } else {
        // Load from sessionStorage
        const stored = sessionStorage.getItem('currentRecipe');
        if (!stored) {
          router.replace('/');
          return;
        }
        try {
          setRecipe(JSON.parse(stored));
        } catch {
          router.replace('/');
        }
      }
      setLoading(false);
    }
    load();
  }, [savedId, router]);

  const handleSave = useCallback(async () => {
    if (!recipe || saveState !== 'idle') return;
    setSaveState('saving');
    try {
      const res = await fetch(`${API_BASE}/api/saved`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipe }),
      });
      const data = await res.json() as { error?: string; id?: string };
      if (res.status === 409) {
        toastRef.current?.show('Already saved!');
        setSaveState('saved');
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Could not save recipe.');
      toastRef.current?.show('Recipe saved! 🔖', 'success');
      setSaveState('saved');
      if (data.id && recipe) {
        const updated = { ...recipe, id: data.id };
        setRecipe(updated);
        sessionStorage.setItem('currentRecipe', JSON.stringify(updated));
      }
    } catch (err) {
      toastRef.current?.show(err instanceof Error ? err.message : 'Could not save.', 'error');
      setSaveState('idle');
    }
  }, [recipe, saveState]);

  const handleRemove = useCallback(async () => {
    if (!savedId || !confirm('Remove this recipe from your saved collection?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/saved/${encodeURIComponent(savedId)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not remove recipe.');
      toastRef.current?.show('Recipe removed.');
      setTimeout(() => router.push('/saved'), 1200);
    } catch (err) {
      toastRef.current?.show(err instanceof Error ? err.message : 'Could not remove.', 'error');
    }
  }, [savedId, router]);

  const r = recipe as Recipe & { _error?: string };

  return (
    <div className="recipe-page">
      {/* Action bar */}
      <div className="recipe-header-bar">
        <div className="recipe-header-inner">
          <button className="nav-back" onClick={() => router.back()}>
            ← Back
          </button>
          {!loading && r && !r._error && (
            savedId ? (
              <button className="btn btn-saved" onClick={handleRemove}>
                ✓ Saved
              </button>
            ) : (
              <button
                className={`btn ${saveState === 'saved' ? 'btn-saved' : 'btn-primary'}`}
                onClick={handleSave}
                disabled={saveState === 'saving' || saveState === 'saved'}
                style={{ minWidth: 140 }}
              >
                {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? '✓ Saved' : 'Save Recipe'}
              </button>
            )
          )}
        </div>
      </div>

      {/* Content */}
      <main className="recipe-content">
        {loading ? null : r?._error ? (
          <div style={{ textAlign: 'center', padding: '4rem 1.5rem' }}>
            <p style={{ fontSize: '2rem', marginBottom: '1rem' }}>😕</p>
            <h2 style={{ marginBottom: '.5rem' }}>Recipe not found</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>{r._error}</p>
            <Link href="/saved" className="btn btn-outline">← Back to Saved Recipes</Link>
          </div>
        ) : r ? (
          <>
            {r.image && !imgError && (
              <img
                src={r.image}
                alt={r.title}
                className="recipe-hero-image"
                loading="lazy"
                onError={() => setImgError(true)}
              />
            )}

            <h1 className="recipe-title">{r.title || 'Untitled Recipe'}</h1>

            {r.url && (
              <span className="recipe-source-link">
                Source:{' '}
                <a href={r.url} target="_blank" rel="noopener noreferrer">
                  {r.domain || r.url}
                </a>
              </span>
            )}

            {r.description && (
              <p className="recipe-description">{r.description}</p>
            )}

            {(r.prepTime || r.cookTime || r.totalTime || r.servings) && (
              <div className="recipe-meta" aria-label="Recipe details">
                <MetaChip label="Prep Time" value={r.prepTime} />
                <MetaChip label="Cook Time" value={r.cookTime} />
                <MetaChip label="Total Time" value={r.totalTime} />
                <MetaChip label="Servings" value={r.servings} />
              </div>
            )}

            <div className="recipe-body">
              <section aria-labelledby="ingredients-heading">
                <h2 className="section-heading" id="ingredients-heading">Ingredients</h2>
                {r.ingredients?.length ? (
                  <ul className="ingredients-list">
                    {r.ingredients.map((ing, i) => (
                      <IngredientItem key={i} text={ing} index={i} />
                    ))}
                  </ul>
                ) : (
                  <p style={{ color: 'var(--text-muted)', fontSize: '.9rem' }}>No ingredients found.</p>
                )}
              </section>

              <section aria-labelledby="instructions-heading">
                <h2 className="section-heading" id="instructions-heading">Instructions</h2>
                {r.instructions?.length ? (
                  <ol className="instructions-list" aria-label="Instructions">
                    {(() => {
                      let stepNum = 0;
                      return r.instructions.map((instr, i) => {
                        if (instr.startsWith('__section__')) {
                          return (
                            <li key={i} className="instruction-section-header" role="presentation">
                              {instr.slice('__section__'.length)}
                            </li>
                          );
                        }
                        stepNum++;
                        return (
                          <li key={i} className="instruction-step">
                            <span className="step-number" aria-hidden="true">{stepNum}</span>
                            <span className="step-text">{instr}</span>
                          </li>
                        );
                      });
                    })()}
                  </ol>
                ) : (
                  <p style={{ color: 'var(--text-muted)', fontSize: '.9rem' }}>No instructions found.</p>
                )}
              </section>
            </div>
          </>
        ) : null}
      </main>

      <LoadingOverlay visible={loading} message="Loading recipe…" />
      <Toast ref={toastRef} />
    </div>
  );
}
