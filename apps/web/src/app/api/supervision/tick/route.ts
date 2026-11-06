import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireViewer } from '@/server/auth';
import { handleRouteError } from '@/server/http';
import { getRepository } from '@/server/repository';
import { supervisionTick } from '@/server/supervision';

export const dynamic = 'force-dynamic';

const body = z.object({ clientId: z.string().trim().min(8).max(80) });

/** Ritmo da ronda do gerente (somente o navegador líder age; o servidor decide). */
export async function POST(req: NextRequest) {
  try {
    const viewer = await requireViewer();
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'clientId inválido' }, { status: 400 });
    const result = await supervisionTick(getRepository(), viewer.companyId!, parsed.data.clientId);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
