import { redirect } from 'next/navigation';
import { OfficeApp } from '@/components/OfficeApp';
import { getViewer } from '@/server/auth';
import { getRepository } from '@/server/repository';

export const dynamic = 'force-dynamic';

/** Tela inicial: o escritório 3D. */
export default async function HomePage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (!viewer.companyId) redirect('/onboarding');
  const snapshot = await getRepository().getOfficeSnapshot(viewer.companyId);
  if (!snapshot) redirect('/onboarding');
  return <OfficeApp initialSnapshot={snapshot} isDirector={viewer.role === 'director'} />;
}
