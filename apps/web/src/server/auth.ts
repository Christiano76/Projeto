import 'server-only';

import { isSupabaseConfigured } from '@/lib/env';
import { getUserSupabase } from '@/lib/supabase/server';
import { getMemoryRepository } from './repository';
import type { Viewer } from './repository/types';

export const LOCAL_DIRECTOR_ID = 'local-director';
export const LOCAL_COMPANY_NAME = 'Agência Digital (modo local)';

/**
 * Identifica o usuário da requisição.
 *  - Supabase: sessão do Supabase Auth + perfil em `public.users` (lido sob RLS).
 *  - Modo local: um diretor local fixo, com a empresa criada automaticamente.
 */
export async function getViewer(): Promise<Viewer | null> {
  if (!isSupabaseConfigured()) {
    const repo = getMemoryRepository();
    const viewer: Viewer = { userId: LOCAL_DIRECTOR_ID, email: null, companyId: null, role: 'director' };
    const { companyId } = await repo.bootstrapCompany(viewer, LOCAL_COMPANY_NAME);
    return { ...viewer, companyId };
  }

  const supabase = await getUserSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const { data: profile } = await supabase
    .from('users')
    .select('company_id, role')
    .eq('id', data.user.id)
    .maybeSingle();
  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    companyId: (profile?.company_id as string | null) ?? null,
    role: (profile?.role as Viewer['role']) ?? 'member',
  };
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function requireViewer(opts: { director?: boolean; company?: boolean } = {}): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) throw new HttpError(401, 'não autenticado');
  if (opts.company !== false && !viewer.companyId) throw new HttpError(409, 'empresa ainda não criada');
  if (opts.director && viewer.role !== 'director') throw new HttpError(403, 'apenas o diretor pode executar esta ação');
  return viewer;
}
