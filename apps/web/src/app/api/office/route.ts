import { NextResponse } from 'next/server';
import { requireViewer } from '@/server/auth';
import { handleRouteError } from '@/server/http';
import { getRepository } from '@/server/repository';

export const dynamic = 'force-dynamic';

/** Snapshot completo do escritório (layout + funcionários + eventos recentes). */
export async function GET() {
  try {
    const viewer = await requireViewer();
    const snapshot = await getRepository().getOfficeSnapshot(viewer.companyId!);
    if (!snapshot) return NextResponse.json({ error: 'empresa não encontrada' }, { status: 404 });
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
