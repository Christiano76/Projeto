import { redirect } from 'next/navigation';
import { getViewer } from '@/server/auth';
import { OnboardingForm } from './OnboardingForm';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (viewer.companyId) redirect('/');
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-brand-50 to-slate-200 p-4">
      <OnboardingForm />
    </main>
  );
}
