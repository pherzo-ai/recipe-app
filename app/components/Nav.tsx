'use client';

import Link from 'next/link';

interface NavProps {
  activePath: string;
}

export default function Nav({ activePath }: NavProps) {
  return (
    <nav className="nav" role="navigation">
      <div className="nav-inner">
        <Link href="/" className="nav-logo">
          <span className="logo-icon">🍳</span>
          Mise
        </Link>
        <div className="nav-links">
          <Link
            href="/saved"
            className={`nav-link${activePath === '/saved' ? ' active' : ''}`}
            aria-current={activePath === '/saved' ? 'page' : undefined}
          >
            Saved Recipes
          </Link>
        </div>
      </div>
    </nav>
  );
}
