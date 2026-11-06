import 'server-only';

import { isSupabaseConfigured } from '@/lib/env';
import { getAdminSupabase } from '@/lib/supabase/server';
import { MemoryRepository } from './memory';
import { SupabaseRepository } from './supabase';
import type { Repository } from './types';

const globalRef = globalThis as unknown as { __agencyMemoryRepo?: MemoryRepository };

/** Repositório em memória compartilhado por todo o processo (sobrevive ao HMR). */
export function getMemoryRepository(): MemoryRepository {
  if (!globalRef.__agencyMemoryRepo) globalRef.__agencyMemoryRepo = new MemoryRepository();
  return globalRef.__agencyMemoryRepo;
}

export function getRepository(): Repository {
  return isSupabaseConfigured() ? new SupabaseRepository(getAdminSupabase()) : getMemoryRepository();
}

export type { Repository, Viewer } from './types';
