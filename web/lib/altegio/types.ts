// web/lib/altegio/types.ts
// TypeScript типи для Alteg.io API

export type Company = {
  id: number;
  name?: string; // Може бути в title, public_title або name
  title?: string;
  public_title?: string;
  active?: boolean | number; // Може бути 0/1 або true/false
  // ... інші поля з API
};

export type Client = {
  id: number;
  name: string;
  phone?: string;
  email?: string;
  // Кастомні поля для Instagram username (можливі варіанти назв)
  'instagram-user-name'?: string; // API key з налаштувань (kebab-case)
  instagram_user_name?: string; // snake_case варіант
  instagramUsername?: string; // camelCase варіант
  instagram_username?: string; // інший snake_case варіант
  // Додаткові поля (може бути об'єкт custom_fields)
  custom_fields?: Record<string, any>;
  [key: string]: any; // Дозволяємо додаткові поля
};

export type Appointment = {
  id: number;
  company_id: number;
  client_id?: number;
  client?: Client; // Інформація про клієнта (якщо включена)
  date?: string;
  datetime?: string; // Дата та час запису
  start_datetime?: string;
  end_datetime?: string;
  service_id?: number;
  service?: any; // Інформація про послугу
  staff_id?: number; // ID майстра/співробітника
  staff?: any; // Інформація про майстра
  status?: string; // Статус запису (pending, confirmed, completed, canceled)
  comment?: string;
  // ... інші поля з API
  [key: string]: any; // Дозволяємо додаткові поля
};

// ---- Finance / Analytics ----

export type AltegioOverallAnalytics = {
  income_total_stats?: {
    current_sum?: string | number;
    previous_sum?: string | number;
    change_percent?: number;
    currency?: { symbol?: string };
  };
  income_services_stats?: {
    current_sum?: string | number;
    previous_sum?: string | number;
    change_percent?: number;
    currency?: { symbol?: string };
  };
  income_goods_stats?: {
    current_sum?: string | number;
    previous_sum?: string | number;
    change_percent?: number;
    currency?: { symbol?: string };
  };
  income_average_stats?: {
    current_sum?: string | number;
    previous_sum?: string | number;
    change_percent?: number;
    currency?: { symbol?: string };
  };
};

export type AltegioIncomeDailySeries = {
  label?: string;
  data?: [string, number][];
};

export type FinanceSummary = {
  range: { date_from: string; date_to: string };
  currency: string;
  totals: {
    total: number;
    services: number;
    goods: number;
    avgCheck: number | null;
  };
  incomeDaily: { date: string; value: number }[];
};


