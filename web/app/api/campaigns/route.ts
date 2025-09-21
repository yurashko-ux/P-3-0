// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';

// Legacy placeholder to avoid import errors during build.
export async function GET() {
  // If you need the real implementation, keep it in app/api/campaigns/index/route.ts instead.
  return NextResponse.json({ disabled: true });
}

export async function POST() {
  return NextResponse.json({ disabled: true });
}
