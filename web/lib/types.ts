export type Counters = { v1: number; v2: number; exp: number };

export type Base = {
  pipeline?: string;
  status?: string;
  pipelineName?: string;
  statusName?: string;
};

export type Campaign = {
  id: string;
  name?: string;
  v1?: string;
  v2?: string;
  base?: Base;
  counters?: Counters;
  deleted?: boolean;
  createdAt?: number;
};
