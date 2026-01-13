import { NextResponse } from 'next/server';

import { db } from '@/analytics/client';

export async function POST() {
  await Promise.all([
    db.table('trips').count('*', 'trip_count').cache({ tags: ['trips'], ttlMs: 30_000 }).execute(),
  ]);
  return NextResponse.json({ status: 'warmed' });
}
