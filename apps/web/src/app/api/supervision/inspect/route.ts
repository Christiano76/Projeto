import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireViewer } from '@/server/auth';
import { handleRouteError } from '@/server/http';
import { getRepository } from '@/server/repository';
import { recordInspection } from '@/server/supervision';

export const dynamic = 'force-dynamic';

const body = z.object({
  clientId: z.string().trim().min(8).max(80),
  targetEmployeeId: z.string().trim().min(1).max(120),
});

/** Chegada do gerente ao funcionário: o servidor consulta o estado real e registra. */
export async function POST(req: NextRequest) {
  try {
    const viewer = await requireViewer();
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'requisição inválida' }, { status: 400 });
    const r = await recordInspection(getRepository(), viewer.companyId!, parsed.data.clientId, parsed.data.targetEmployeeId);
    const status = r.status === 'done' ? 201 : r.status === 'too_early' ? 425 : 409;
    return NextResponse.json(r, { status });
  } catch (err) {
    return handleRouteError(err);
  }
}
