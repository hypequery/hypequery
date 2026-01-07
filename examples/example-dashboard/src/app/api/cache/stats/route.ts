import { NextResponse } from 'next/server';
import { getDashboardCacheStats } from '@/lib/queries';

export function GET() {
  return NextResponse.json(getDashboardCacheStats());
}
