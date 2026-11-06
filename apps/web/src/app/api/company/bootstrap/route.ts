import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireViewer } from '@/server/auth';
import { handleRouteError } from '@/server/http';
import { getRepository } from '@/server/repository';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ name: z.string().trim().min(2).max(120) });

/** Cria a empresa do usuário recém-cadastrado (ele se torna o diretor). */
export async function POST(req: NextRequest) {
  try {
    const viewer = await requireViewer({ company: false });
    if (viewer.companyId) return NextResponse.json({ companyId: viewer.companyId });
    const body = bodySchema.safeParse(await req.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: 'nome da empresa inválido' }, { status: 400 });
    const result = await getRepository().bootstrapCompany(viewer, body.data.name);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
