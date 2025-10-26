// web/app/api/admin/status/route.ts
import { NextResponse } from "next/server";

import { getEnvValue } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_CANDIDATES = [
  "KEYCRM_BASE_URL",
  "KEYCRM_API_URL",
  "KEYCRM_API_BASE",
];

const TOKEN_CANDIDATES = [
  "KEYCRM_BEARER",
  "KEYCRM_API_BEARER",
  "KEYCRM_API_TOKEN",
  "KEYCRM_TOKEN",
];

function normaliseBase(base: string | undefined): string | null {
  if (!base) return null;
  const trimmed = base.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "");
}

function buildAuthorization(token: string | undefined): string | null {
  if (!token) return null;
  const trimmed = token.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase().startsWith("bearer ") ? trimmed : `Bearer ${trimmed}`;
}

type PingResult = {
  attempted: boolean;
  ok: boolean;
  status: number | null;
  endpoint: string | null;
  error: string | null;
};

async function pingKeycrm(base: string, authorization: string): Promise<PingResult> {
  const endpoint = `${base.replace(/\/+$/, "")}/pipelines?per_page=1`;
  try {
    const res = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: authorization,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (res.ok) {
      return { attempted: true, ok: true, status: res.status, endpoint, error: null };
    }

    let error: string | null = null;
    try {
      const text = await res.text();
      error = text ? text.slice(0, 500) : null;
    } catch {
      error = null;
    }

    return {
      attempted: true,
      ok: false,
      status: res.status,
      endpoint,
      error,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { attempted: true, ok: false, status: null, endpoint, error };
  }
}

export async function GET() {
  const baseCandidate = normaliseBase(getEnvValue(...BASE_CANDIDATES));
  const tokenCandidate = buildAuthorization(getEnvValue(...TOKEN_CANDIDATES));

  let ping: PingResult = {
    attempted: false,
    ok: false,
    status: null,
    endpoint: null,
    error: baseCandidate && tokenCandidate ? null : "credentials_incomplete",
  };

  if (baseCandidate && tokenCandidate) {
    ping = await pingKeycrm(baseCandidate, tokenCandidate);
  }

  const response = {
    ok: Boolean(baseCandidate && tokenCandidate && ping.ok),
    timestamp: new Date().toISOString(),
    keycrm: {
      hasBaseUrl: Boolean(baseCandidate),
      hasToken: Boolean(tokenCandidate),
      baseUrl: baseCandidate,
      ping,
    },
  } as const;

  return NextResponse.json(response, { status: response.ok ? 200 : 200 });
}

export async function POST() {
  return GET();
}
