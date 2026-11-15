// Вкладка «Ручні показники»: те, чого не взяти з системи, — людина вносить у боті в робочий день.
"use client";

import { ProcessList } from "../_components/ProcessList";

const MANUAL_KINDS = ["manual_metric" as const];

export default function ManualMetricsPage() {
  return (
    <ProcessList
      kinds={MANUAL_KINDS}
      createLabel="+ Новий показник"
      intro="Ручний показник — те, чого не можна взяти з системи: людина вносить число в боті в кожен робочий день, наприклад скільки роздано сертифікатів. Робочий день і час нагадування задаються в процесі; зміни діють із наступного дня."
    />
  );
}
