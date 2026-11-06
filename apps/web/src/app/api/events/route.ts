import { SYSTEM_ONLY_EVENT_TYPES, type AgentEventType } from '@agency/core';
import { NextResponse, type NextRequest } from 'next/server';
import { requireViewer } from '@/server/auth';
import { ingestEvent } from '@/server/events';
import { handleRouteError } from '@/server/http';
import { getRepository } from '@/server/repository';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const viewer = await requireViewer();
    const limit = Number(req.nextUrl.searchParams.get('limit') ?? 50);
    const employeeId = req.nextUrl.searchParams.get('employeeId') ?? undefined;
    const events = await getRepository().listEvents(viewer.companyId!, {
      limit: Number.isFinite(limit) ? limit : 50,
      ...(employeeId ? { employeeId } : {}),
    });
    return NextResponse.json({ events }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * Registra um evento MANUAL (console do diretor). Os agentes (Fase 2/3)
 * usarão o mesmo serviço `ingestEvent` com source = agent/orchestrator.
 */
export async function POST(req: NextRequest) {
  try {
    const viewer = await requireViewer({ director: true });
    const raw = await req.json().catch(() => null);
    if (SYSTEM_ONLY_EVENT_TYPES.includes((raw as { type?: AgentEventType } | null)?.type as AgentEventType)) {
      // Supervisão só pode ser registrada pelo servidor, a partir de dados reais.
      return NextResponse.json({ error: 'evento reservado ao sistema' }, { status: 403 });
    }
    const result = await ingestEvent(getRepository(), {
      companyId: viewer.companyId!,
      raw,
      source: 'manual',
      actorUserId: viewer.userId,
    });
    switch (result.status) {
      case 'applied':
        return NextResponse.json(result, { status: 201 });
      case 'rejected':
        return NextResponse.json(result, { status: 409 });
      case 'invalid':
        return NextResponse.json({ error: result.error }, { status: 400 });
      case 'not_found':
        return NextResponse.json({ error: 'funcionário não encontrado' }, { status: 404 });
    }
  } catch (err) {
    return handleRouteError(err);
  }
}
