import { after } from 'next/server';
import { handleTelemetry } from '@/lib/telemetry/handler';

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function POST(request: Request): Promise<Response> {
  return handleTelemetry(request, callback => after(callback));
}
