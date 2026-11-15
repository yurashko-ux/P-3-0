// Вкладка «Процеси»: процеси від подій і за розкладом.
"use client";

import { EVENT_PROCESS_KINDS } from "@/lib/business-processes/config";
import { ProcessList } from "./_components/ProcessList";

export default function BusinessProcessesPage() {
  return (
    <ProcessList
      kinds={EVENT_PROCESS_KINDS}
      createLabel="+ Новий процес"
      intro="Процес — правило салону: коли запускати, кому дати завдання і що відповісти. Завдання надсилатиме Telegram-бот: майстрам — бот майстрів, решті — окремий бот. Зміни налаштувань діють лише для нових завдань."
    />
  );
}
