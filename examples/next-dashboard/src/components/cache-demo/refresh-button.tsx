'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';

export default function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
    >
      {pending ? 'Refreshing…' : 'Refresh Data'}
    </Button>
  );
}
