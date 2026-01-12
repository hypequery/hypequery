import { NextResponse } from 'next/server';
import { invalidateCacheDemo } from '@/lib/queries';

export async function POST() {
  await invalidateCacheDemo();
  return NextResponse.json({ success: true });
}
