import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/env';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ ok: true, mode: isSupabaseConfigured() ? 'supabase' : 'memory', time: new Date().toISOString() });
}
