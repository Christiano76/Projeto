import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { readServerEnv } from '../env';

/** Cliente com a sessão do usuário (cookies). Sujeito a RLS. */
export async function getUserSupabase(): Promise<SupabaseClient> {
  const env = readServerEnv();
  const store = await cookies();
  return createServerClient(env.supabaseUrl!, env.supabaseAnonKey!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Chamado a partir de um Server Component: o middleware renova a sessão.
        }
      },
    },
  });
}

let admin: SupabaseClient | null = null;

/**
 * Cliente administrativo (service role) — ignora RLS. Use SOMENTE depois de
 * autenticar e autorizar o usuário no servidor.
 */
export function getAdminSupabase(): SupabaseClient {
  if (!admin) {
    const env = readServerEnv();
    admin = createClient(env.supabaseUrl!, env.supabaseServiceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}
