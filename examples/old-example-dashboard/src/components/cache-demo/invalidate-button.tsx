'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

export default function InvalidateButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex items-center gap-3 text-sm">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            await fetch('/api/cache-demo/invalidate', { method: 'POST' });
            setMessage('Cache invalidated. Click "Refresh Data" to fetch a fresh copy.');
          });
        }}
      >
        {pending ? 'Invalidating…' : 'Invalidate Cache'}
      </Button>
      {message && <span className="text-yellow-600">{message}</span>}
    </div>
  );
}
