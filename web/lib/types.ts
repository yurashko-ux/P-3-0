// web/lib/types.ts

export type Counters = { v1: number; v2: number; exp: number };

export type IdName = {
  pipeline?: string;      // KeyCRM pipeline id
  status?: string;        // KeyCRM status id
  pipelineName?: string;  // cached human name
  statusName?: string;    // cached human name
};

export type Base = IdName;
export type Target = IdName;

export type Campaign = {
  id: string;           // e.g. epoch ms or nanoid
  name: string;
  v1?: string;
  v2?: string;
  base?: Base;
  t1?: Target;
  t2?: Target;
  texp?: Target;
  counters: Counters;
  deleted?: boolean;
  createdAt: number;    // epoch ms
};

// Guards/helpers
export const hasIds = (t?: Target) => !!t?.pipeline && !!t?.status;
export const namesMissing = (t?: Target) =>
  !!t && (!t.pipelineName || !t.statusName);
