'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publicEnv } from '../publicEnv';

let client: SupabaseClient | null = null;

/** Cliente do navegador (anon key + sessão do usuário). Sujeito a RLS. */
export function getBrowserSupabase(): SupabaseClient {
  if (!client) client = createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
  return client;
}
