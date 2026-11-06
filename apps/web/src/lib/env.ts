import 'server-only';

/**
 * Leitura centralizada de variáveis de ambiente do SERVIDOR.
 * Segredos (service role, chaves de IA) nunca devem ser importados no cliente:
 * o pacote `server-only` quebra o build se isso acontecer.
 */
export interface ServerEnv {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  supabaseServiceRoleKey: string | null;
  forceMemory: boolean;
}

export function readServerEnv(): ServerEnv {
  const v = (k: string) => {
    const value = process.env[k]?.trim();
    return value ? value : null;
  };
  return {
    supabaseUrl: v('NEXT_PUBLIC_SUPABASE_URL'),
    supabaseAnonKey: v('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    supabaseServiceRoleKey: v('SUPABASE_SERVICE_ROLE_KEY'),
    forceMemory: v('AGENCY_FORCE_MEMORY_MODE') === 'true',
  };
}

export function isSupabaseConfigured(env: ServerEnv = readServerEnv()): boolean {
  return !env.forceMemory && !!env.supabaseUrl && !!env.supabaseAnonKey && !!env.supabaseServiceRoleKey;
}
