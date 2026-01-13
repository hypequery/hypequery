import { NextResponse } from 'next/server';
import { api } from '@/analytics/api';

export async function POST() {
  await api.run('invalidateCache');
  return NextResponse.json({ success: true });
}
