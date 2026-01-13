// web/app/admin/direct/_components/AdminToolsModal.tsx
// Модальне вікно з усіма адмін-інструментами та тестами

"use client";

import { useState } from "react";

interface AdminToolsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  showCopyableAlert: (message: string) => void;
  loadData: () => Promise<void>;
}

export function AdminToolsModal({
  isOpen,
  onClose,
  isLoading,
  setIsLoading,
  showCopyableAlert,
  loadData,
}: AdminToolsModalProps) {
  if (!isOpen) return null;

  const handleEndpoint = async (
    endpoint: string,
    method: "GET" | "POST" = "POST",
    confirmMessage?: string,
    successMessage?: (data: any) => string
  ) => {
    if (confirmMessage && !confirm(confirmMessage)) {
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(endpoint, { method });
      const data = await res.json();
      
      if (data.ok) {
        const message = successMessage
          ? successMessage(data)
          : `✅ Операція завершена!\n\n${JSON.stringify(data, null, 2)}`;
        showCopyableAlert(message);
        await loadData();
      } else {
        showCopyableAlert(`❌ Помилка: ${data.error || "Невідома помилка"}\n\n${JSON.stringify(data, null, 2)}`);
      }
    } catch (err) {
      showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const tools = [
    {
      category: "Синхронізація",
      items: [
        {
          label: "Синхронізувати з KeyCRM",
          endpoint: "/api/admin/direct/sync-keycrm",
          method: "POST" as const,
          confirm: "Синхронізувати клієнтів з KeyCRM?",
          className: "btn-sm",
        },
        {
          label: "Завантажити з Altegio",
          endpoint: "/api/admin/direct/sync-altegio-bulk",
          method: "POST" as const,
          confirm: "Завантажити всіх клієнтів з Altegio?",
          className: "btn-sm",
        },
        {
          label: "Синхронізувати сьогоднішні вебхуки",
          endpoint: "/api/admin/direct/sync-today-webhooks",
          method: "POST" as const,
          confirm: "Синхронізувати вебхуки за сьогодні?",
          className: "btn-sm",
        },
        {
          label: "Синхронізувати ManyChat вебхуки",
          endpoint: "/api/admin/direct/sync-manychat-webhooks",
          method: "POST" as const,
          confirm: "Синхронізувати вебхуки ManyChat?",
          className: "btn-sm",
        },
        {
          label: "Синхронізувати без Instagram",
          endpoint: "/api/admin/direct/sync-missing-instagram",
          method: "POST" as const,
          confirm: "Синхронізувати клієнтів без Instagram з вебхуків?",
          className: "btn-sm btn-warning",
        },
      ],
    },
    {
      category: "Очищення та виправлення",
      items: [
        {
          label: "Видалити дублікати стану 'client'",
          endpoint: "/api/admin/direct/remove-duplicate-client-states",
          method: "POST" as const,
          confirm: "Видалити дублікати стану 'client'?",
          className: "btn-sm btn-warning",
        },
        {
          label: "Видалити дублікати consultation- станів",
          endpoint: "/api/admin/direct/remove-duplicate-consultation-states",
          method: "POST" as const,
          confirm: "Видалити дублікати consultation- станів?",
          className: "btn-sm btn-warning",
        },
        {
          label: "Очистити paidServiceDate для консультацій",
          endpoint: "/api/admin/direct/cleanup-paid-service-dates",
          method: "POST" as const,
          confirm: "Очистити помилково встановлені paidServiceDate для клієнтів з консультаціями?",
          className: "btn-sm btn-warning",
          successMessage: (data: any) =>
            `✅ Очищення завершено!\n\nВсього клієнтів: ${data.total}\nОчищено: ${data.cleaned}\n\n${
              data.cleanedClients && data.cleanedClients.length > 0
                ? `Очищені клієнти:\n${data.cleanedClients.map((c: string) => `  - ${c}`).join("\n")}\n\n`
                : ""
            }${JSON.stringify(data, null, 2)}`,
        },
      ],
    },
    {
      category: "Синхронізація дат",
      items: [
        {
          label: "Синхронізувати paidServiceDate з вебхуків",
          endpoint: "/api/admin/direct/sync-paid-service-dates",
          method: "POST" as const,
          confirm: "Синхронізувати paidServiceDate з вебхуків для платних послуг?",
          className: "btn-sm btn-success",
          successMessage: (data: any) =>
            `✅ Синхронізація завершена!\n\nВсього клієнтів: ${data.results.total}\nОновлено: ${data.results.updated}\nПропущено: ${data.results.skipped}\nПомилок: ${data.results.errors}\n\n${
              data.results.details && data.results.details.length > 0
                ? `Оновлені клієнти:\n${data.results.details
                    .slice(0, 20)
                    .map((d: any) => `  - ${d.instagramUsername || d.altegioClientId} (${d.reason})`)
                    .join("\n")}${data.results.details.length > 20 ? `\n... і ще ${data.results.details.length - 20} клієнтів` : ""}\n\n`
                : ""
            }${JSON.stringify(data, null, 2)}`,
        },
        {
          label: "Синхронізувати consultationAttended з вебхуків",
          endpoint: "/api/admin/direct/sync-consultation-attendance",
          method: "POST" as const,
          confirm: "Синхронізувати consultationAttended з вебхуків для консультацій?",
          className: "btn-sm btn-success",
          successMessage: (data: any) =>
            `✅ Синхронізація завершена!\n\nВсього клієнтів: ${data.results.total}\nОновлено: ${data.results.updated}\nПропущено: ${data.results.skipped}\nПомилок: ${data.results.errors}\n\n${
              data.results.details && data.results.details.length > 0
                ? `Оновлені клієнти:\n${data.results.details
                    .slice(0, 20)
                    .map((d: any) => `  - ${d.instagramUsername || d.altegioClientId}: ${d.oldConsultationAttended} -> ${d.newConsultationAttended} (${d.reason})`)
                    .join("\n")}${data.results.details.length > 20 ? `\n... і ще ${data.results.details.length - 20} клієнтів` : ""}\n\n`
                : ""
            }${JSON.stringify(data, null, 2)}`,
        },
      ],
    },
    {
      category: "Об'єднання дублікатів",
      items: [
        {
          label: "Об'єднати дублікати по імені",
          endpoint: "/api/admin/direct/merge-duplicates-by-name",
          method: "POST" as const,
          confirm: "Об'єднати дублікати клієнтів з однаковим іменем та прізвищем?",
          className: "btn-sm",
        },
      ],
    },
    {
      category: "Діагностика",
      items: [
        {
          label: "Діагностика дублікатів 'client'",
          endpoint: "/api/admin/direct/diagnose-duplicate-clients",
          method: "GET" as const,
          className: "btn-sm btn-ghost",
        },
        {
          label: "Тест ManyChat API Key",
          endpoint: "/api/admin/direct/test-manychat-api-key",
          method: "GET" as const,
          className: "btn-sm btn-ghost",
        },
        {
          label: "Тест KeyCRM Messages",
          endpoint: "/api/admin/direct/test-keycrm-messages",
          method: "GET" as const,
          className: "btn-sm btn-ghost",
        },
        {
          label: "Запустити міграцію Telegram Chat ID",
          endpoint: "/api/admin/direct/run-telegram-chat-id-migration",
          method: "POST" as const,
          confirm: "Виконати міграцію зміни типу telegramChatId з Int на BigInt?",
          className: "btn-sm btn-ghost",
        },
      ],
    },
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto m-4">
        <div className="sticky top-0 bg-white border-b p-4 flex justify-between items-center">
          <h2 className="text-2xl font-bold">🔧 Інструменти адміністратора</h2>
          <button
            onClick={onClose}
            className="btn btn-sm btn-circle btn-ghost"
            disabled={isLoading}
          >
            ✕
          </button>
        </div>
        
        <div className="p-4 space-y-6">
          {tools.map((category, categoryIndex) => (
            <div key={categoryIndex} className="border-b pb-4 last:border-b-0">
              <h3 className="text-lg font-semibold mb-3 text-gray-700">
                {category.category}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {category.items.map((item, itemIndex) => (
                  <button
                    key={itemIndex}
                    className={`btn ${item.className || ""}`}
                    onClick={() =>
                      handleEndpoint(
                        item.endpoint,
                        item.method,
                        item.confirm,
                        item.successMessage
                      )
                    }
                    disabled={isLoading}
                    title={item.confirm || item.label}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        
        <div className="sticky bottom-0 bg-white border-t p-4 flex justify-end">
          <button
            onClick={onClose}
            className="btn btn-sm"
            disabled={isLoading}
          >
            Закрити
          </button>
        </div>
      </div>
    </div>
  );
}
