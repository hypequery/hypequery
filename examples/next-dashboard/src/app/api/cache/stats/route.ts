import { NextResponse } from 'next/server';

import { db } from '@/analytics/client';

export function GET() {
  return NextResponse.json(db.cache?.getStats?.() ?? {});
}
