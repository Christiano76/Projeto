import 'server-only';

import { NextResponse } from 'next/server';
import { HttpError } from './auth';

/** Converte erros em respostas JSON sem vazar detalhes internos. */
export function handleRouteError(err: unknown): NextResponse {
  if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error('[api] erro inesperado', err);
  return NextResponse.json({ error: 'erro interno' }, { status: 500 });
}
