'use client';

import type { Employee } from '@agency/core';
import { useRouter } from 'next/navigation';
import { EventConsole } from '@/components/EventConsole';

export function ManualConsole({ employees }: { employees: Employee[] }) {
  const router = useRouter();
  return <EventConsole employees={employees} onApplied={() => router.refresh()} />;
}
