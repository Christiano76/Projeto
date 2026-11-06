import { redirect } from 'next/navigation';
import { ThemeToggle } from '@/components/ThemeToggle';
import { getViewer } from '@/server/auth';
import { OnboardingForm } from './OnboardingForm';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (viewer.companyId) redirect('/');
  return (
    <main className="app-backdrop relative flex min-h-dvh items-center justify-center p-4">
      <div className="glass absolute right-4 top-4 rounded-xl p-1">
        <ThemeToggle />
      </div>
      <OnboardingForm />
    </main>
  );
}
