import { NextResponse, type NextRequest } from 'next/server';
import { isSupabaseConfigured } from '@/lib/env';
import { getUserSupabase } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  if (isSupabaseConfigured()) {
    const supabase = await getUserSupabase();
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL('/login', req.url), { status: 303 });
}
