'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface PublicUser {
  id: string;
  name: string;
  tenantName: string;
}

/** The demo's login: signing in as someone else starts a new chat. */
export function UserSwitcher({ users, currentId }: { users: PublicUser[]; currentId?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signIn(userId: string) {
    setPending(true);
    await fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId }) });
    setPending(false);
    router.refresh();
  }

  return (
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
  );
}
