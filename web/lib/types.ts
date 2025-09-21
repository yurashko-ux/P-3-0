// web/lib/types.ts
// Мінімальні типи та нормалізація кампанії без залежностей від zod.

export type RuleOp = 'contains' | 'equals';

export type Rule = {
  op: RuleOp;
  value: string; // може бути '', окрім v1 (має бути непорожній)
};

export type Rules = {
  v1: Rule;           // обов'язково, value !== ''
  v2?: Rule | null;   // опційно; якщо нема — підставимо {op:'contains', value:''}
};

export type CampaignInput = {
  id?: string;
  name: string;
  created_at?: number;
  active?: boolean;
  base_pipeline_id: number;
  base_status_id: number;
  rules: Rules;
  exp?: {
    days?: number;
    to_pipeline_id?: number;
    to_status_id?: number;
  };
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

export type Campaign = CampaignInput & {
  id: string;
  created_at: number;
  active: boolean;
  rules: {
    v1: Rule;
    v2: Rule; // у нормалізованому вигляді завжди присутній
  };
  v1_count: number;
  v2_count: number;
  exp_count: number;

  // збагачення назвами (можуть бути null)
  base_pipeline_name?: string | null;
  base_status_name?: string | null;
  exp?: CampaignInput['exp'] & {
    to_pipeline_name?: string | null;
    to_status_name?: string | null;
  };
};

function uuid(): string {
  // Використовуємо Web Crypto якщо є, інакше фолбек
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    // @ts-ignore
    return crypto.randomUUID();
  }
  // простий фолбек
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0,
      v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function normalizeCampaign(input: CampaignInput): Campaign {
  // найпростіша валідація
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid payload');
  }
  const name = String(input.name ?? '').trim();
  if (!name) throw new Error('name is required');

  const v1 = input.rules?.v1;
  if (!v1 || !v1.value || !String(v1.value).trim()) {
    throw new Error('rules.v1.value is required (non-empty)');
  }

  const id = input.id && String(input.id).trim() ? String(input.id).trim() : uuid();
  const created_at = Number.isFinite(input.created_at as any)
    ? Number(input.created_at)
    : Date.now();

  const rules = {
    v1: {
      op: (v1.op as RuleOp) || 'contains',
      value: String(v1.value).trim(),
    },
    v2: {
      op: (input.rules?.v2?.op as RuleOp) || 'contains',
      value: String(input.rules?.v2?.value ?? ''),
    },
  } as const;

  const exp = input.exp
    ? {
        days: input.exp.days,
        to_pipeline_id: input.exp.to_pipeline_id,
        to_status_id: input.exp.to_status_id,
      }
    : undefined;

  return {
    id,
    name,
    created_at,
    active: Boolean(input.active ?? false),
    base_pipeline_id: Number(input.base_pipeline_id),
    base_status_id: Number(input.base_status_id),
    rules,
    exp,
    v1_count: Number.isFinite(input.v1_count as any) ? Number(input.v1_count) : 0,
    v2_count: Number.isFinite(input.v2_count as any) ? Number(input.v2_count) : 0,
    exp_count: Number.isFinite(input.exp_count as any) ? Number(input.exp_count) : 0,
  };
}
