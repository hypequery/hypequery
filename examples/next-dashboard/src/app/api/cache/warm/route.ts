import { NextResponse } from 'next/server';

import { db } from '@/analytics/client';

export const dynamic = 'force-dynamic';

export async function POST() {
  await Promise.all([
    db.table('trips').count('trip_id', 'trip_count').cache({ tags: ['trips'], ttlMs: 30_000 }).execute(),
  ]);
  return NextResponse.json({ status: 'warmed' });
}
