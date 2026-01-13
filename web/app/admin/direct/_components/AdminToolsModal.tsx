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
    successMessage?: (data: any) => string,
    body?: any
  ) => {
    if (confirmMessage && !confirm(confirmMessage)) {
      return;
    }

    setIsLoading(true);
    try {
      const options: RequestInit = { method };
      if (body) {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify(body);
      }
      
      const res = await fetch(endpoint, options);
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

  const handlePromptEndpoint = async (
    endpoint: string,
    method: "GET" | "POST" = "POST",
    promptMessage: string,
    promptValue?: string,
    successMessage?: (data: any) => string
  ) => {
    const input = prompt(promptMessage, promptValue);
    if (!input || !input.trim()) {
      return;
    }
    
    setIsLoading(true);
    try {
      const options: RequestInit = { method };
      if (method === "POST") {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify({ [promptValue || 'input']: input.trim() });
      }
      
      const res = await fetch(endpoint, options);
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
          icon: "🔗",
          label: "Синхронізувати з KeyCRM",
          endpoint: "/api/admin/direct/sync-keycrm",
          method: "POST" as const,
          confirm: "Синхронізувати клієнтів з KeyCRM?",
        },
        {
          icon: "⬇️",
          label: "Завантажити з Altegio",
          endpoint: "/api/admin/direct/sync-altegio-bulk",
          method: "POST" as const,
          confirm: "Завантажити всіх клієнтів з Altegio?",
        },
        {
          icon: "🔄",
          label: "Синхронізувати сьогоднішні вебхуки",
          endpoint: "/api/admin/direct/sync-today-webhooks",
          method: "POST" as const,
          confirm: "Синхронізувати вебхуки за сьогодні?",
        },
        {
          icon: "📱",
          label: "Синхронізувати ManyChat вебхуки",
          endpoint: "/api/admin/direct/sync-manychat-webhooks",
          method: "POST" as const,
          confirm: "Синхронізувати вебхуки ManyChat?",
        },
        {
          icon: "⚠️",
          label: "Синхронізувати без Instagram",
          endpoint: "/api/admin/direct/sync-missing-instagram",
          method: "POST" as const,
          confirm: "Синхронізувати клієнтів без Instagram з вебхуків?",
        },
      ],
    },
    {
      category: "Очищення та виправлення",
      items: [
        {
          icon: "🗑️",
          label: "Видалити дублікати стану 'client'",
          endpoint: "/api/admin/direct/remove-duplicate-client-states",
          method: "POST" as const,
          confirm: "Видалити дублікати стану 'client'?",
        },
        {
          icon: "🗑️",
          label: "Видалити дублікати consultation- станів",
          endpoint: "/api/admin/direct/remove-duplicate-consultation-states",
          method: "POST" as const,
          confirm: "Видалити дублікати consultation- станів?",
        },
        {
          icon: "🧹",
          label: "Очистити paidServiceDate для консультацій",
          endpoint: "/api/admin/direct/cleanup-paid-service-dates",
          method: "POST" as const,
          confirm: "Очистити помилково встановлені paidServiceDate для клієнтів з консультаціями?",
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
          icon: "✅",
          label: "Синхронізувати paidServiceDate з вебхуків",
          endpoint: "/api/admin/direct/sync-paid-service-dates",
          method: "POST" as const,
          confirm: "Синхронізувати paidServiceDate з вебхуків для платних послуг?",
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
          icon: "✅",
          label: "Синхронізувати consultationAttended з вебхуків",
          endpoint: "/api/admin/direct/sync-consultation-attendance",
          method: "POST" as const,
          confirm: "Синхронізувати consultationAttended з вебхуків для консультацій?",
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
          icon: "🔗",
          label: "Об'єднати дублікати по імені",
          endpoint: "/api/admin/direct/merge-duplicates-by-name",
          method: "POST" as const,
          confirm: "Об'єднати дублікати клієнтів з однаковим іменем та прізвищем?",
        },
      ],
    },
    {
      category: "Діагностика",
      items: [
        {
          icon: "🔍",
          label: "Діагностика дублікатів 'client'",
          endpoint: "/api/admin/direct/diagnose-duplicate-clients",
          method: "GET" as const,
        },
        {
          icon: "🔍",
          label: "Діагностика клієнта",
          endpoint: "/api/admin/direct/diagnose-client",
          method: "POST" as const,
          prompt: "Введіть Instagram username (наприклад: @tania.pidgaina) або повне ім'я клієнтки (наприклад: таня підгайна):",
          isPrompt: true,
        },
        {
          icon: "🔍",
          label: "Пошук вебхуків",
          endpoint: "/api/admin/direct/search-webhooks",
          method: "GET" as const,
          prompt: "Введіть Instagram username клієнта (без @):",
          isPrompt: true,
        },
        {
          icon: "🧪",
          label: "Тест ManyChat API Key",
          endpoint: "/api/admin/direct/test-manychat-api-key",
          method: "GET" as const,
        },
        {
          icon: "🧪",
          label: "Тест KeyCRM Messages",
          endpoint: "/api/admin/direct/test-keycrm-messages",
          method: "GET" as const,
        },
        {
          icon: "🧪",
          label: "Тест клієнта Altegio",
          endpoint: "/api/admin/direct/test-altegio-client",
          method: "POST" as const,
          prompt: "Введіть Altegio Client ID для тестування (наприклад, 176404915):",
          isPrompt: true,
        },
        {
          icon: "🔗",
          label: "Тест вебхука Altegio",
          endpoint: "/api/admin/direct/test-altegio-webhook",
          method: "POST" as const,
          prompt: "Введіть Altegio Client ID для тестування вебхука (наприклад, 176404915):",
          isPrompt: true,
        },
        {
          icon: "🧪",
          label: "Тест KV",
          endpoint: "/api/admin/direct/test-kv",
          method: "GET" as const,
        },
        {
          icon: "📋",
          label: "Останні вебхуки",
          endpoint: "/api/altegio/webhook",
          method: "GET" as const,
        },
        {
          icon: "🔧",
          label: "Запустити міграцію Telegram Chat ID",
          endpoint: "/api/admin/direct/run-telegram-chat-id-migration",
          method: "POST" as const,
          confirm: "Виконати міграцію зміни типу telegramChatId з Int на BigInt?",
        },
      ],
    },
    {
      category: "Повідомлення",
      items: [
        {
          icon: "📨",
          label: "Відправити повідомлення",
          endpoint: "/api/admin/direct/send-missing-instagram-notifications",
          method: "POST" as const,
          confirm: "Відправити Telegram повідомлення для всіх клієнтів без Instagram?",
        },
      ],
    },
    {
      category: "Відновлення",
      items: [
        {
          icon: "♻️",
          label: "Відновити клієнта",
          endpoint: "/api/admin/direct/recover-client",
          method: "POST" as const,
        },
      ],
    },
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-y-auto m-4">
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
        
        <div className="p-6 space-y-8">
          {tools.map((category, categoryIndex) => (
            <div key={categoryIndex} className="border-b pb-6 last:border-b-0">
              <h3 className="text-lg font-semibold mb-4 text-gray-700">
                {category.category}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {category.items.map((item, itemIndex) => {
                  const handleClick = () => {
                    if (item.isPrompt && item.prompt) {
                      const input = prompt(item.prompt);
                      if (!input || !input.trim()) return;
                      
                      if (item.endpoint.includes('diagnose-client')) {
                        const isInstagram = input.startsWith('@') || input.includes('_') || /^[a-z0-9._]+$/i.test(input);
                        handleEndpoint(
                          item.endpoint,
                          item.method,
                          undefined,
                          undefined,
                          isInstagram
                            ? { instagramUsername: input.replace('@', '') }
                            : { fullName: input }
                        );
                      } else if (item.endpoint.includes('search-webhooks')) {
                        handleEndpoint(
                          `${item.endpoint}?instagram=${encodeURIComponent(input.trim().replace('@', ''))}`,
                          item.method
                        );
                      } else if (item.endpoint.includes('test-altegio-webhook')) {
                        const format = prompt('Виберіть формат custom_fields:\n1. array_title_value\n2. array_name_value\n3. object_keys\n4. object_camel\n5. object_spaces\n\nВведіть номер (1-5) або залиште порожнім:');
                        const formatMap: Record<string, string> = {
                          '1': 'array_title_value',
                          '2': 'array_name_value',
                          '3': 'object_keys',
                          '4': 'object_camel',
                          '5': 'object_spaces',
                        };
                        const customFieldsFormat = format && formatMap[format] ? formatMap[format] : 'array_title_value';
                        handleEndpoint(
                          item.endpoint,
                          item.method,
                          undefined,
                          undefined,
                          { clientId: input.trim(), customFieldsFormat }
                        );
                      } else {
                        handleEndpoint(
                          item.endpoint,
                          item.method,
                          undefined,
                          undefined,
                          { client_id: input.trim() }
                        );
                      }
                    } else {
                      handleEndpoint(
                        item.endpoint,
                        item.method,
                        item.confirm,
                        item.successMessage
                      );
                    }
                  };

                  return (
                    <button
                      key={itemIndex}
                      className="flex flex-col items-center justify-center p-4 border-2 border-blue-500 rounded-lg bg-white hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[120px]"
                      onClick={handleClick}
                      disabled={isLoading}
                      title={item.confirm || item.prompt || item.label}
                    >
                      <div className="text-4xl mb-3">{item.icon}</div>
                      <div className="text-xs text-center text-blue-700 font-medium leading-tight px-1">
                        {item.label}
                      </div>
                    </button>
                  );
                })}
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
