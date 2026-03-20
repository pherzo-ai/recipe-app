'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import LoadingOverlay from './LoadingOverlay';
import Toast, { ToastHandle } from './Toast';

const API_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export default function HomePage() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('Fetching recipe…');
  const toastRef = useRef<ToastHandle>(null);

  // Pre-fill from ?url= query param (bookmarklet-style)
  useEffect(() => {
    const qp = new URLSearchParams(window.location.search);
    const qUrl = qp.get('url');
    if (qUrl) setUrl(qUrl);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const raw = url.trim();
    if (!raw) {
      setError('Please enter a recipe URL.');
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(raw.startsWith('http') ? raw : 'https://' + raw);
    } catch {
      setError("That doesn't look like a valid URL. Try pasting the full address.");
      return;
    }

    setLoading(true);
    setLoadingMsg('Fetching recipe…');

    const msgTimer = setTimeout(() => {
      setLoadingMsg('Extracting ingredients & instructions…');
    }, 3000);

    try {
      const res = await fetch(`${API_BASE}/api/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: parsed.href }),
      });

      const data = await res.json() as { success?: boolean; error?: string; recipe?: unknown };

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Something went wrong. Please try a different URL.');
      }

      sessionStorage.setItem('currentRecipe', JSON.stringify(data.recipe));
      router.push('/recipe');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not load recipe. Please try again.';
      setError(msg);
      toastRef.current?.show('Failed to load recipe', 'error');
    } finally {
      clearTimeout(msgTimer);
      setLoading(false);
    }
  }

  return (
    <>
      <main className="hero">
        <div className="hero-inner">
          <span className="hero-eyebrow">Recipe Viewer</span>

          <h1 className="hero-title">
            Just the recipe.<br />Nothing else.
          </h1>

          <p className="hero-subtitle">
            Paste a link to any recipe page and we&apos;ll extract exactly what you need —
            ingredients, measurements, and instructions — free from ads and filler.
          </p>

          <form className="url-form" onSubmit={handleSubmit} noValidate>
            <div className="url-input-wrap">
              <span className="url-input-icon" aria-hidden="true">🔗</span>
              <input
                type="url"
                className="url-input"
                placeholder="https://www.example.com/recipes/chocolate-chip-cookies"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setError(''); }}
                autoComplete="url"
                spellCheck={false}
                required
              />
            </div>
            {error && (
              <div className="error-banner visible" role="alert">{error}</div>
            )}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
            >
              View Recipe
            </button>
          </form>

          <p className="hero-hint">Works with AllRecipes, NYT Cooking, Serious Eats, and thousands more.</p>

          <div className="hero-divider">What you get</div>

          <ul className="feature-list" aria-label="Features">
            <li className="feature-item"><span className="fi-icon" aria-hidden="true">✅</span> Clean ingredients list</li>
            <li className="feature-item"><span className="fi-icon" aria-hidden="true">📋</span> Step-by-step instructions</li>
            <li className="feature-item"><span className="fi-icon" aria-hidden="true">🔖</span> Save for later</li>
            <li className="feature-item"><span className="fi-icon" aria-hidden="true">🚫</span> Zero ads</li>
          </ul>
        </div>
      </main>

      <LoadingOverlay visible={loading} message={loadingMsg} />
      <Toast ref={toastRef} />
    </>
  );
}
