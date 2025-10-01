// --- Локальні типи (щоб не залежати від зовнішніх імпортів)
export type Campaign = {
  id: string;
  name?: string;
  v1: { value?: string };
  v2: { value?: string };
  base: {
    pipeline?: string;
    status?: string;
    pipelineName?: string;
    statusName?: string;
  };
  counters: { v1: number; v2: number; exp: number };
  createdAt?: string | number | Date;
  deleted?: boolean;
};

export type ApiList = {
  ok: boolean;
  items?: Campaign[];
  count?: number;
};
