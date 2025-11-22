// web/lib/altegio/types.ts
// TypeScript типи для Alteg.io API

export type Company = {
  id: number;
  name: string;
  active?: boolean;
  // ... інші поля з API
};

export type Client = {
  id: number;
  name: string;
  phone?: string;
  email?: string;
  // ... інші поля з API
};

export type Appointment = {
  id: number;
  company_id: number;
  client_id?: number;
  date?: string;
  // ... інші поля з API
};

