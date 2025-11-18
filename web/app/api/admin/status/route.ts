// web/app/api/admin/status/route.ts
import { NextResponse } from "next/server";

import { getEnvValue } from "@/lib/env";
import { buildKeycrmBaseCandidates } from "@/lib/keycrm-move";

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
  const rawBase = getEnvValue(...BASE_CANDIDATES);
  const tokenCandidate = buildAuthorization(getEnvValue(...TOKEN_CANDIDATES));
  const baseCandidates = buildKeycrmBaseCandidates(rawBase);

  let ping: PingResult = {
    attempted: false,
    ok: false,
    status: null,
    endpoint: null,
    error:
      baseCandidates.length && tokenCandidate
        ? null
        : !rawBase
          ? "credentials_incomplete"
          : tokenCandidate
            ? "no_valid_base"
            : "credentials_incomplete",
  };

  if (baseCandidates.length && tokenCandidate) {
    for (const candidate of baseCandidates) {
      ping = await pingKeycrm(candidate, tokenCandidate);
      if (ping.ok) {
        break;
      }
    }
  }

  const response = {
    ok: Boolean(baseCandidates.length && tokenCandidate && ping.ok),
    timestamp: new Date().toISOString(),
    keycrm: {
      hasBaseUrl: Boolean(rawBase && rawBase.trim().length),
      hasToken: Boolean(tokenCandidate),
      baseUrl: baseCandidates[0] ?? rawBase?.trim() ?? null,
      ping,
    },
  } as const;

  return NextResponse.json(response, { status: response.ok ? 200 : 200 });
}

export async function POST() {
  return GET();
}
