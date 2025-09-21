// web/app/api/admin/status/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ disabled: true });
}

export async function POST() {
  return NextResponse.json({ disabled: true });
}

