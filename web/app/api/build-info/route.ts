// web/app/api/build-info/route.ts
// Діагностика: який коміт задеплоєно на Vercel (VERCEL_GIT_COMMIT_SHA).

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'edge';

export async function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || '';
  const ref = process.env.VERCEL_GIT_COMMIT_REF || '';
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID || '';
  return NextResponse.json({
    ok: true,
    sha,
    ref,
    deploymentId,
    timestamp: new Date().toISOString(),
  });
}
