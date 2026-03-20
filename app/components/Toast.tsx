'use client';

import { forwardRef, useImperativeHandle, useRef, useCallback } from 'react';

export interface ToastHandle {
  show: (message: string, type?: 'success' | 'error' | '') => void;
}

const Toast = forwardRef<ToastHandle>((_, ref) => {
  const elRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, type: 'success' | 'error' | '' = '') => {
    if (!elRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    elRef.current.textContent = message;
    elRef.current.className = `toast show${type ? ' ' + type : ''}`;
    timerRef.current = setTimeout(() => {
      if (elRef.current) elRef.current.className = 'toast';
    }, 3500);
  }, []);

  useImperativeHandle(ref, () => ({ show }), [show]);

  return <div ref={elRef} className="toast" role="status" aria-live="polite" />;
});

Toast.displayName = 'Toast';
export default Toast;
