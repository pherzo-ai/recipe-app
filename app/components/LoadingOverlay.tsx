'use client';

interface LoadingOverlayProps {
  visible: boolean;
  message?: string;
}

export default function LoadingOverlay({ visible, message = 'Loading…' }: LoadingOverlayProps) {
  return (
    <div
      className={`loading-overlay${visible ? ' visible' : ''}`}
      aria-live="polite"
      aria-label={visible ? message : undefined}
    >
      <div className="spinner" role="progressbar" aria-label="Loading" />
      <p className="loading-text">{message}</p>
    </div>
  );
}
