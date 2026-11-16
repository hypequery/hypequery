'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { requestSignIn } from '@/lib/sign-in';

interface PublicUser {
  id: string;
  name: string;
  tenantName: string;
}

/** The demo's login: signing in as someone else starts a new chat. */
export function UserSwitcher({ users, currentId }: { users: PublicUser[]; currentId?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function signIn(userId: string) {
    setPending(true);
    setError(undefined);
    try {
      const failure = await requestSignIn(userId);
      if (failure === undefined) router.refresh();
      else setError(failure);
    } finally {
      // Whatever happened, the buttons work again, so the user can retry.
      setPending(false);
    }
  }

  return (
    <>
      <div className="toolbar" role="group" aria-label="Signed in as">
        <span className="muted">Signed in as</span>
        {users.map((user) => (
          <button
            key={user.id}
            type="button"
            className="chip"
            aria-pressed={user.id === currentId}
            disabled={pending}
            onClick={() => signIn(user.id)}
          >
            {user.name} · {user.tenantName}
          </button>
        ))}
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
    </>
  );
}
