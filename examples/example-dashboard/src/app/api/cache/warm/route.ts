import { NextResponse } from 'next/server';
import { warmDashboardCache } from '@/lib/queries';

export async function POST() {
  await warmDashboardCache();
  return NextResponse.json({ status: 'warmed' });
}
