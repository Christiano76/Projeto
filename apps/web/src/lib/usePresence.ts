'use client';

import { useEffect, useState } from 'react';

/**
 * Mantém um elemento montado durante a animação de saída.
 * `state` = 'in' | 'out'; desmonta após `exitMs`.
 */
export function usePresence<T>(value: T | null | undefined, exitMs = 240): { item: T | null; state: 'in' | 'out' } {
  const [item, setItem] = useState<T | null>(value ?? null);
  const [state, setState] = useState<'in' | 'out'>('in');

  useEffect(() => {
    if (value) {
      setItem(value);
      setState('in');
      return;
    }
    setState('out');
    const id = setTimeout(() => setItem(null), exitMs);
    return () => clearTimeout(id);
  }, [value, exitMs]);

  return { item: value ?? item, state: value ? 'in' : state };
}
