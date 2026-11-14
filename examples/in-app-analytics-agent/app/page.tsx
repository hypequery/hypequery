import { cookies } from 'next/headers';
import { Chat } from '@/components/chat';
import { UserSwitcher } from '@/components/user-switcher';
import { DEMO_USERS, findDemoUser } from '@/lib/demo-users';
import { SESSION_COOKIE } from '@/lib/session';

export default async function Home() {
  const user = findDemoUser((await cookies()).get(SESSION_COOKIE)?.value);
  // The browser gets names only. It never sees, sends or chooses a tenant id.
  const users = DEMO_USERS.map(({ id, name, tenantName }) => ({ id, name, tenantName }));
  return (
    <main className="page">
      <header>
        <h1>Ask your analytics</h1>
        <p className="muted">
          An AI SDK agent with hypequery Cloud&apos;s tools. Each answer is scoped to the signed-in user&apos;s
          customer by the token the server mints for their session.
        </p>
      </header>
      <UserSwitcher users={users} currentId={user?.id} />
      {user ? (
        <Chat key={user.id} customer={user.tenantName} />
      ) : (
        <p className="muted">Pick a demo user to start.</p>
      )}
    </main>
  );
}
