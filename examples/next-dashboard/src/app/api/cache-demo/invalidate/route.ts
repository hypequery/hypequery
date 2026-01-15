import { NextResponse } from 'next/server';
import { api } from '@/analytics/queries';

export async function POST() {
  await api.execute('invalidateCache');
  return NextResponse.json({ success: true });
}
