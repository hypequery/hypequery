import { NextResponse } from 'next/server';

import { db } from '@/analytics/client';

// Prevent static prerendering which would fail without env vars
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(db.cache?.getStats?.() ?? {});
}
