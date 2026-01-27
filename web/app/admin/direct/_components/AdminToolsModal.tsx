// web/app/admin/direct/_components/AdminToolsModal.tsx
// Модальне вікно з усіма адмін-інструментами та тестами

"use client";

import { useState } from "react";
import Link from "next/link";

interface AdminToolsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  showCopyableAlert: (message: string) => void;
  loadData: () => Promise<void>;
  setIsWebhooksModalOpen?: (open: boolean) => void;
  setIsManyChatWebhooksModalOpen?: (open: boolean) => void;
  setIsTelegramMessagesModalOpen?: (open: boolean) => void;
  onActivateColumnWidthEdit?: () => void;
}

export function AdminToolsModal({
  isOpen,
  onClose,
  isLoading,
  setIsLoading,
  showCopyableAlert,
  loadData,
  setIsWebhooksModalOpen,
  setIsManyChatWebhooksModalOpen,
  setIsTelegramMessagesModalOpen,
  onActivateColumnWidthEdit,
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
        {
          icon: "📱",
          label: "Синхронізувати telegramNotificationSent",
          endpoint: "/api/admin/direct/sync-telegram-notification-sent",
          method: "POST" as const,
          confirm: "Синхронізувати telegramNotificationSent для клієнтів з missing_instagram_*?",
          successMessage: (data: any) =>
            `✅ Синхронізація завершена!\n\nВсього клієнтів: ${data.results.total}\nОновлено: ${data.results.updated}\nВже встановлено: ${data.results.alreadySet}\nБез Altegio ID: ${data.results.noAltegioId}\nНе знайдено в логах: ${data.results.notFoundInLogs}\nПомилок: ${data.results.errors}\n\n${
              data.results.details && data.results.details.length > 0
                ? `Деталі:\n${data.results.details
                    .slice(0, 20)
                    .map((d: any) => `  - ${d.instagramUsername || d.clientId} (${d.status})${d.altegioClientId ? ` - Altegio ID: ${d.altegioClientId}` : ''}`)
                    .join("\n")}${data.results.details.length > 20 ? `\n... і ще ${data.results.details.length - 20} клієнтів` : ""}\n\n`
                : ""
            }${JSON.stringify(data, null, 2)}`,
        },
        {
          icon: "🔄",
          label: "Оновити стани",
          endpoint: "/api/admin/direct/update-states-from-records",
          method: "POST" as const,
          confirm: "Оновити стани всіх клієнтів на основі записів з вебхуків?",
          successMessage: (data: any) =>
            `✅ Оновлення станів завершено!\n\nВсього клієнтів: ${data.stats.totalClients}\nОновлено: ${data.stats.updated}\nПропущено: ${data.stats.skipped}\nПомилок: ${data.stats.errors}\n\n${JSON.stringify(data, null, 2)}`,
        },
        {
          icon: "💰",
          label: "Синхронізувати витрати та візити",
          endpoint: "/api/admin/direct/sync-spent-visits",
          method: "POST" as const,
          confirm: "Синхронізувати spent та visits з Altegio API для всіх клієнтів?",
          successMessage: (data: any) =>
            `✅ Синхронізація завершена!\n\nВсього клієнтів: ${data.stats.totalClients}\nОновлено: ${data.stats.updated}\nПропущено: ${data.stats.skipped}\nПомилок: ${data.stats.errors}\n\n${JSON.stringify(data, null, 2)}`,
        },
        {
          icon: "⏰",
          label: "Перевірити статус cron job (sync-direct-altegio-metrics)",
          endpoint: "/api/admin/direct/cron-sync-direct-altegio-metrics-status",
          method: "GET" as const,
          successMessage: (data: any) => {
            const lastRun = data.lastRun;
            if (!lastRun) {
              return `❌ Cron job ніколи не запускався автоматично\n\nПеревірте налаштування в vercel.json\n\n${JSON.stringify(data, null, 2)}`;
            }
            const phase = lastRun.phase;
            const via = lastRun.via || 'unknown';
            const startedAt = lastRun.startedAt;
            const finishedAt = lastRun.finishedAt;
            const stats = lastRun.stats;
            
            let message = `📊 Статус cron job: sync-direct-altegio-metrics\n\n`;
            message += `Фаза: ${phase === 'start' ? '🟡 Запущено (в процесі)' : phase === 'done' ? '✅ Завершено' : phase}\n`;
            message += `Запущено через: ${via === 'vercel' ? '✅ Vercel Cron' : via === 'secret' ? '🔑 Secret (ручний)' : via}\n`;
            message += `Початок: ${startedAt ? new Date(startedAt).toLocaleString('uk-UA') : 'немає'}\n`;
            message += `Завершення: ${finishedAt ? new Date(finishedAt).toLocaleString('uk-UA') : phase === 'start' ? '⏳ В процесі...' : 'немає'}\n\n`;
            
            if (stats) {
              message += `Статистика:\n`;
              message += `  Всього клієнтів: ${stats.totalClients || 0}\n`;
              message += `  З Altegio ID: ${stats.targets || 0}\n`;
              message += `  Оброблено: ${stats.processed || 0}\n`;
              message += `  Оновлено: ${stats.updated || 0}\n`;
              message += `  Пропущено (немає змін): ${stats.skippedNoChange || 0}\n`;
              message += `  Помилок: ${stats.errors || 0}\n`;
              message += `  Час виконання: ${stats.ms ? Math.round(stats.ms / 1000) : 0} сек\n`;
            }
            
            // Перевіряємо, чи cron job запускався сьогодні
            if (finishedAt) {
              const finishedDate = new Date(finishedAt);
              const today = new Date();
              const isToday = finishedDate.toDateString() === today.toDateString();
              const hoursAgo = Math.round((today.getTime() - finishedDate.getTime()) / (1000 * 60 * 60));
              
              message += `\n⏰ Останній запуск: ${isToday ? '✅ Сьогодні' : '❌ Не сьогодні'} (${hoursAgo} годин тому)\n`;
              message += `Розклад: щогодини (0 * * * *)\n`;
            }
            
            message += `\n${JSON.stringify(data, null, 2)}`;
            return message;
          },
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
          label: "Діагностика записів",
          endpoint: "/api/admin/direct/debug-records",
          method: "GET" as const,
        },
        {
          icon: "🔍",
          label: "Діагностика нагадувань",
          endpoint: "/api/admin/direct/test-reminder-debug",
          method: "GET" as const,
        },
        {
          icon: "🔍",
          label: "Перевірити дані",
          endpoint: "/api/admin/direct/check-data",
          method: "GET" as const,
        },
        {
          icon: "🔍",
          label: "Перевірити стан клієнта",
          endpoint: "/api/admin/direct/check-client-state",
          method: "GET" as const,
          prompt: "Введіть Altegio ID клієнта для перевірки стану:",
          isPrompt: true,
        },
        {
          icon: "🔍",
          label: "Тест пошуку адміна",
          endpoint: "/api/admin/direct/test-start-command",
          method: "GET" as const,
          prompt: "Введіть Telegram username для перевірки (наприклад: kolachnykv):",
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
          endpoint: "/api/altegio/webhook?limit=20",
          method: "GET" as const,
          successMessage: (data: any) => {
            const clientEvents = data.lastClientEvents || [];
            return `Останні вебхуки Altegio:\n\n` +
              `Всього подій: ${data.eventsCount}\n` +
              `Події по клієнтах: ${data.clientEventsCount || 0}\n` +
              `Події по записах: ${data.recordEventsCount || 0}\n\n` +
              (clientEvents.length > 0 
                ? `Останні події по клієнтах:\n${clientEvents.map((e: any, i: number) => 
                    `${i + 1}. ${e.status} - Client ID: ${e.clientId}, Name: ${e.clientName || '—'}\n` +
                    `   Custom fields: ${e.hasCustomFields ? '✅' : '❌'}, Type: ${e.customFieldsType}, IsArray: ${e.customFieldsIsArray}\n` +
                    `   Received: ${new Date(e.receivedAt).toLocaleString('uk-UA')}`
                  ).join('\n\n')}\n\n`
                : '❌ Немає подій по клієнтах\n\n'
              ) +
              `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
          },
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
      category: "Таблиці та перегляди",
      items: [
        {
          icon: "📊",
          label: "Таблиця вебхуків Altegio",
          endpoint: "modal:webhooks",
          method: "GET" as const,
          isModal: true,
        },
        {
          icon: "📱",
          label: "Сирі вебхуки ManyChat",
          endpoint: "modal:manychat-webhooks",
          method: "GET" as const,
          isModal: true,
        },
        {
          icon: "💬",
          label: "Повідомлення Telegram бота",
          endpoint: "modal:telegram-messages",
          method: "GET" as const,
          isModal: true,
        },
      ],
    },
    {
      category: "Нагадування",
      items: [
        {
          icon: "📱",
          label: "Тест нагадування",
          endpoint: "/api/admin/direct/test-reminder",
          method: "POST" as const,
          confirm: "Надіслати повторне нагадування?\n\nНатисніть OK для повторного нагадування (Недодзвон)\nНатисніть Скасувати для нового нагадування",
          isConfirmWithType: true,
        },
      ],
    },
    {
      category: "Webhook",
      items: [
        {
          icon: "🔗",
          label: "Перевірити webhook",
          endpoint: "/api/admin/direct/check-telegram-webhook",
          method: "GET" as const,
        },
        {
          icon: "⚙️",
          label: "Налаштувати webhook",
          endpoint: "/api/admin/direct/check-telegram-webhook",
          method: "POST" as const,
          confirm: "Налаштувати webhook для HOB_client_bot на спеціальний endpoint (/api/telegram/direct-reminders-webhook)?",
          successMessage: (data: any) => {
            if (typeof window !== 'undefined') {
              const currentUrl = window.location.origin;
              const webhookUrl = `${currentUrl}/api/telegram/direct-reminders-webhook`;
              return `✅ Webhook налаштовано успішно!\n\nURL: ${webhookUrl}\n\nТепер повідомлення від HOB_client_bot будуть оброблятися через спеціальний endpoint.\n\nПовна відповідь:\n${JSON.stringify(data, null, 2)}`;
            }
            return `✅ Webhook налаштовано успішно!\n\nПовна відповідь:\n${JSON.stringify(data, null, 2)}`;
          },
        },
      ],
    },
    {
      category: "Міграція та відновлення",
      items: [
        {
          icon: "🚀",
          label: "Мігрувати дані",
          endpoint: "/api/admin/direct/migrate-data",
          method: "POST" as const,
          confirm: "Виконати міграцію даних з KV → Postgres?",
        },
        {
          icon: "🔄",
          label: "Відновити дані з KV",
          endpoint: "/api/admin/direct/recover-all-data",
          method: "POST" as const,
          confirm: "Відновити всі дані з KV в Postgres?",
        },
        {
          icon: "👥",
          label: "Мігрувати майстрів",
          endpoint: "/api/admin/direct/migrate-masters",
          method: "POST" as const,
          confirm: "Мігрувати майстрів з mock-data в базу даних?",
        },
        {
          icon: "🔧",
          label: "Відновити індекс",
          endpoint: "/api/admin/direct/rebuild-index",
          method: "POST" as const,
          confirm: "Відновити індекс клієнтів?",
        },
        {
          icon: "🔍",
          label: "Перевірити міграцію",
          endpoint: "/api/admin/direct/check-migration",
          method: "GET" as const,
        },
      ],
    },
    {
      category: "Виправлення",
      items: [
        {
          icon: "🔧",
          label: "Виправити пропущені консультації",
          endpoint: "/api/admin/direct/fix-missed-consultations",
          method: "POST" as const,
          confirm: "Виправити пропущені консультації в історії станів?",
        },
        {
          icon: "🗑️",
          label: "Очистити згенеровані",
          endpoint: "/api/admin/direct/cleanup-altegio-generated",
          method: "POST" as const,
          isPreviewFirst: true,
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
    {
      // Додаємо в КІНЕЦЬ, щоб не зсувати нумерацію існуючих кнопок
      category: "Імена",
      items: [
        {
          icon: "🧩",
          label: "Виправити імена з records:log",
          endpoint: "/api/admin/direct/fix-names-from-records",
          method: "POST" as const,
          confirm: "Виправити плейсхолдерні імена ({{full_name}}) з Altegio records log для всіх клієнтів?",
          successMessage: (data: any) =>
            `✅ Виправлення імен завершено!\n\nВсього клієнтів: ${data.stats.totalClients}\nКандидатів: ${data.stats.candidates}\nОновлено: ${data.stats.updated}\nНе знайдено в records:log: ${data.stats.notFoundInLog}\n\n${JSON.stringify(data, null, 2)}`,
        },
      ],
    },
    // ВАЖЛИВО: додаємо нові кнопки в кінець, щоб не зсувати існуючу глобальну нумерацію.
    {
      category: "Синхронізація (майстри)",
      items: [
        {
          icon: "🧑‍🎨",
          label: "Завантажити майстрів в колонку «Майстер»",
          endpoint: "/api/admin/direct/sync-service-masters",
          method: "POST" as const,
          confirm:
            "Заповнити колонку «Майстер» (serviceMasterName) для клієнтів на основі Altegio records?\n\nЗа замовчуванням оновлюємо тільки порожні значення. (Щоб перерахувати всіх — запустіть endpoint з ?all=true&force=true)",
          successMessage: (data: any) =>
            `✅ Синхронізація майстрів завершена!\n\nВсього клієнтів: ${data.results.totalClients}\nПеревірено: ${data.results.checked}\nОновлено: ${data.results.updated}\nБез Altegio ID: ${data.results.skippedNoAltegioId}\nПропущено (вже заповнено): ${data.results.skippedOnlyMissing}\nНемає груп: ${data.results.skippedNoGroups}\nНемає майстра в групі: ${data.results.skippedNoStaff}\nБез змін: ${data.results.skippedNoChange}\nПомилок: ${data.results.errors}\n\n${JSON.stringify(data, null, 2)}`,
        },
        {
          icon: "🔍",
          label: "Діагностика: знайти адміністраторів в колонці «Майстер»",
          endpoint: "/api/admin/direct/debug-master-column",
          method: "GET" as const,
          successMessage: (data: any) =>
            `🔍 Діагностика колонки "Майстер":\n\nВсього клієнтів: ${data.totalClients}\nАдміністраторів/дірект-менеджерів: ${data.adminMasters?.length || 0}\n${data.adminMasters?.map((m: any) => `  - ${m.name} (${m.role})`).join('\n') || ''}\n\nЗнайдено проблем: ${data.issuesFound}\n\n${data.issues?.slice(0, 30).map((i: any) => `  - ${i.instagramUsername || 'no instagram'} (Altegio ${i.altegioClientId || 'no id'}): ${i.issue}`).join('\n') || 'Проблем не знайдено'}${data.issues?.length > 30 ? `\n... і ще ${data.issues.length - 30}` : ''}\n\n${data.note || ''}`,
        },
        {
          icon: "🔍",
          label: "Знайти адміністраторів в колонці «Майстер» (dryRun)",
          endpoint: "/api/admin/direct/cleanup-admin-masters?dryRun=1",
          method: "GET" as const,
          successMessage: (data: any) =>
            `🔍 Знайдено ${data.found} клієнтів з адміністраторами в serviceMasterName:\n\n${data.clients?.slice(0, 20).map((c: any) => `  - ${c.instagramUsername || 'no instagram'} (Altegio ${c.altegioClientId || 'no id'}): "${c.serviceMasterName}"`).join('\n')}${data.clients?.length > 20 ? `\n... і ще ${data.clients.length - 20}` : ''}\n\n${data.note}\n\nДля застосування змін використайте кнопку "Очистити адміністраторів з колонки «Майстер»".`,
        },
        {
          icon: "🧹",
          label: "Очистити адміністраторів з колонки «Майстер»",
          endpoint: "/api/admin/direct/cleanup-admin-masters?dryRun=0",
          method: "GET" as const,
          confirm:
            "Очистити serviceMasterName для клієнтів, де встановлено адміністраторів або дірект-менеджерів?\n\nВАЖЛИВО: Це очистить тільки serviceMasterName (колонка «Майстер»). consultationMasterName (колонка «Запис на консультацію») не зміниться, бо адміністратори можуть проводити консультації.\n\nПродовжити?",
          successMessage: (data: any) =>
            `✅ Очищення завершено!\n\nЗнайдено: ${data.found}\nОчищено: ${data.cleaned}\nПомилок: ${data.errors}\n\n${data.note}`,
        },
      ],
    },
    // ВАЖЛИВО: додаємо нові кнопки ТІЛЬКИ в кінець, щоб не зсувати існуючу глобальну нумерацію.
    {
      category: "Імена (Altegio)",
      items: [
        {
          icon: "🪪",
          label: "Виправити імена з Altegio API",
          endpoint: "/api/admin/direct/fix-names-from-altegio",
          method: "POST" as const,
          confirm:
            "Оновити імена клієнтів з Altegio API (по altegioClientId), якщо поточне імʼя виглядає як інстаграмне/плейсхолдер?\n\nЦе НЕ чіпає Instagram username і НЕ змінює історію повідомлень.",
          successMessage: (data: any) =>
            `✅ Виправлення імен з Altegio API завершено!\n\nВсього клієнтів: ${data.stats.totalClients}\nКандидатів: ${data.stats.candidates}\nОновлено: ${data.stats.updated}\n404/не знайдено: ${data.stats.fetched404}\nПомилок запитів: ${data.stats.fetchedErrors}\nБез імені в Altegio: ${data.stats.noNameInAltegio}\n\n${JSON.stringify(data, null, 2)}`,
        },
      ],
    },
    // ВАЖЛИВО: додаємо нові кнопки ТІЛЬКИ в кінець, щоб не зсувати існуючу глобальну нумерацію.
    {
      category: "Instagram (ManyChat)",
      items: [
        {
          icon: "🖼️",
          label: "Backfill аватарок Instagram (ManyChat → KV)",
          endpoint: "/api/admin/direct/backfill-instagram-avatars?onlyMissing=1&delayMs=150",
          method: "POST" as const,
          confirm:
            "Запустити backfill аватарок Instagram з ManyChat?\n\nВАЖЛИВО: ми НЕ робимо прямих запитів до Instagram і НЕ скрейпимо сторінки. Беремо avatar URL, який повертає ManyChat API, і зберігаємо в KV для показу в таблиці.\n\nЗа замовчуванням: onlyMissing=1 (пропускаємо валідні URL в KV). Якщо в KV лежать “биті” значення — вони будуть перезаписані.\n\nПідказка: для примусового перезапису всіх — відкрийте endpoint з &force=1.\n\nМоже зайняти кілька хвилин (залежить від кількості клієнтів).",
          successMessage: (data: any) => {
            const s = data?.stats || {};
            const sample = Array.isArray(data?.samples) ? data.samples : [];
            const sampleLines = sample.slice(0, 15).map((x: any) => `  - ${x.username} (${x.action})`).join("\n");
            return (
              `✅ Backfill завершено!\n\n` +
              `Клієнтів у базі: ${s.clientsTotal || 0}\n` +
              `Унікальних username: ${s.usernamesUnique || 0}\n` +
              `Оброблено username: ${s.processed || 0}\n` +
              `Знайдено subscriber: ${s.foundSubscriber || 0}\n` +
              `З аватаркою: ${s.withAvatar || 0}\n` +
              `Збережено: ${s.saved || 0}\n` +
              `Пропущено (вже було в KV): ${s.skippedExists || 0}\n` +
              `“Биті” значення в KV (перезаписані): ${s.invalidExisting || 0}\n` +
              `Пропущено (без аватарки): ${s.skippedNoAvatar || 0}\n` +
              `Пропущено (без Instagram): ${s.skippedNoInstagram || 0}\n` +
              `Помилок: ${s.errors || 0}\n` +
              `Час: ${s.ms || 0} ms\n\n` +
              (sampleLines ? `Приклади:\n${sampleLines}\n\n` : '') +
              `${JSON.stringify(data, null, 2)}`
            );
          },
        },
      ],
    },
    // ВАЖЛИВО: додаємо нові кнопки ТІЛЬКИ в кінець, щоб не зсувати існуючу глобальну нумерацію.
    {
      category: "Телефони (Altegio)",
      items: [
        {
          icon: "📞",
          label: "Backfill телефонів (Altegio → Prisma)",
          endpoint: "/api/admin/direct/backfill-altegio-phones?onlyMissing=1&delayMs=250",
          method: "POST" as const,
          confirm:
            "Запустити backfill телефонів з Altegio в Prisma?\n\nЗа замовчуванням: onlyMissing=1 (оновлюємо тільки порожні телефони).\n\nПідказка: для примусового перезапису — додайте &force=1.\n\nМоже зайняти кілька хвилин (залежить від кількості клієнтів).",
          successMessage: (data: any) => {
            const s = data?.stats || {};
            const sample = Array.isArray(data?.samples) ? data.samples : [];
            const sampleLines = sample
              .slice(0, 15)
              .map((x: any) => `  - ${x.instagramUsername} (Altegio ID: ${x.altegioClientId}) (${x.action})`)
              .join("\n");
            return (
              `✅ Backfill телефонів завершено!\n\n` +
              `Всього клієнтів: ${s.totalClients || 0}\n` +
              `З Altegio ID: ${s.targets || 0}\n` +
              `Оброблено: ${s.processed || 0}\n` +
              `Оновлено: ${s.updated || 0}\n` +
              `Пропущено (без Altegio ID): ${s.skippedNoAltegioId || 0}\n` +
              `Пропущено (вже було): ${s.skippedExists || 0}\n` +
              `Пропущено (нема телефону): ${s.skippedNoPhone || 0}\n` +
              `Пропущено (без змін): ${s.skippedNoChange || 0}\n` +
              `404/не знайдено: ${s.fetchedNotFound || 0}\n` +
              `Помилок: ${s.errors || 0}\n` +
              `Час: ${s.ms || 0} ms\n\n` +
              (sampleLines ? `Приклади:\n${sampleLines}\n\n` : "") +
              `${JSON.stringify(data, null, 2)}`
            );
          },
        },
      ],
    },
    // ВАЖЛИВО: додаємо нові кнопки ТІЛЬКИ в кінець, щоб не зсувати існуючу глобальну нумерацію.
    {
      category: "Візити (Altegio)",
      items: [
        {
          icon: "📅",
          label: "Оновити lastVisitAt (Altegio → Prisma, FORCE)",
          endpoint: "/api/admin/direct/sync-last-visit?onlyMissing=0&delayMs=150",
          method: "POST" as const,
          confirm:
            "Оновити lastVisitAt для ВСІХ клієнтів з Altegio?\n\nFORCE режим: onlyMissing=0 — перезаписуємо lastVisitAt, якщо в Altegio є новіша дата.\n\nЦе потрібно для коректної колонки «Днів з останнього візиту».\n\nupdatedAt НЕ змінюємо.\n\nМоже зайняти кілька хвилин.",
          successMessage: (data: any) => {
            const s = data?.stats || {};
            const sample = Array.isArray(data?.samples) ? data.samples : [];
            const sampleLines = sample
              .slice(0, 15)
              .map((x: any) => `  - Altegio ID: ${x.altegioClientId} (${x.action}) ${x.lastVisitAt ? `→ ${x.lastVisitAt}` : ''}`)
              .join("\n");
            return (
              `✅ Синхронізація lastVisitAt завершена!\n\n` +
              `Всього клієнтів: ${s.totalClients || 0}\n` +
              `З Altegio ID: ${s.targets || 0}\n` +
              `Оброблено: ${s.processed || 0}\n` +
              `Оновлено: ${s.updated || 0}\n` +
              `Пропущено (без Altegio ID): ${s.skippedNoAltegioId || 0}\n` +
              `Пропущено (нема lastVisit в Altegio): ${s.skippedNoLastVisit || 0}\n` +
              `Пропущено (вже було): ${s.skippedExists || 0}\n` +
              `Пропущено (без змін): ${s.skippedNoChange || 0}\n` +
              `Помилок: ${s.errors || 0}\n` +
              `Час: ${s.ms || 0} ms\n\n` +
              (sampleLines ? `Приклади:\n${sampleLines}\n\n` : "") +
              `${JSON.stringify(data, null, 2)}`
            );
          },
        },
      ],
    },
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-y-auto m-4">
        <div className="sticky top-0 bg-white border-b p-4 flex justify-between items-center">
          <h2 className="text-2xl font-bold">🔧 Інструменти адміністратора</h2>
          <div className="flex items-center gap-2">
            {/* Кнопки навігації */}
            <Link href="/admin/campaigns" className="btn btn-xs btn-ghost" onClick={onClose}>
              📋 Кампанії
            </Link>
            <button
              className="btn btn-xs btn-ghost"
              onClick={() => {
                onActivateColumnWidthEdit?.();
                onClose();
              }}
            >
              📏 Редагувати розміри таблиці
            </button>
            <Link href="/admin/campaigns/new" className="btn btn-xs btn-ghost" onClick={onClose}>
              ✨ Нова кампанія
            </Link>
            <Link href="/admin/debug" className="btn btn-xs btn-ghost" onClick={onClose}>
              🧪 Тестова сторінка
            </Link>
            <Link href="/admin/altegio" className="btn btn-xs btn-ghost" onClick={onClose}>
              📊 Альтеджіо
            </Link>
            <Link href="/admin/photo-reports" className="btn btn-xs btn-ghost" onClick={onClose}>
              📸 Фото-звіти
            </Link>
            {/* Кнопка закриття */}
            <button
              onClick={onClose}
              className="btn btn-sm btn-circle btn-ghost"
              disabled={isLoading}
            >
              ✕
            </button>
          </div>
        </div>
        
        <div className="p-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {tools.flatMap((category, categoryIndex) => 
              category.items.map((item, itemIndex) => {
                const globalIndex = tools.slice(0, categoryIndex).reduce((sum, cat) => sum + cat.items.length, 0) + itemIndex + 1;
                const handleClick = () => {
                    // Обробка модальних вікон
                    if (item.isModal) {
                      if (item.endpoint === "modal:webhooks" && setIsWebhooksModalOpen) {
                        setIsWebhooksModalOpen(true);
                        onClose();
                        return;
                      }
                      if (item.endpoint === "modal:manychat-webhooks" && setIsManyChatWebhooksModalOpen) {
                        setIsManyChatWebhooksModalOpen(true);
                        onClose();
                        return;
                      }
                      if (item.endpoint === "modal:telegram-messages" && setIsTelegramMessagesModalOpen) {
                        setIsTelegramMessagesModalOpen(true);
                        onClose();
                        return;
                      }
                    }

                    // Обробка test-reminder з типом
                    if (item.isConfirmWithType) {
                      const type = confirm(item.confirm || "") ? 'repeat' : 'new';
                      handleEndpoint(
                        item.endpoint,
                        item.method,
                        undefined,
                        undefined,
                        { type }
                      );
                      return;
                    }

                    // Обробка cleanup-altegio-generated з preview
                    if (item.isPreviewFirst) {
                      setIsLoading(true);
                      fetch(item.endpoint)
                        .then(res => res.json())
                        .then(previewData => {
                          if (previewData.ok) {
                            const count = previewData.stats?.toDelete || 0;
                            if (count === 0) {
                              alert('✅ Немає клієнтів для видалення');
                              setIsLoading(false);
                              return;
                            }
                            
                            const confirmMessage = `Знайдено ${count} клієнтів з Altegio, які мають згенерований Instagram username (починається з "altegio_").\n\nВидалити їх?`;
                            if (confirm(confirmMessage)) {
                              handleEndpoint(item.endpoint, "POST" as const);
                            } else {
                              setIsLoading(false);
                            }
                          } else {
                            showCopyableAlert(`Помилка перегляду: ${previewData.error || 'Невідома помилка'}\n\n${JSON.stringify(previewData, null, 2)}`);
                            setIsLoading(false);
                          }
                        })
                        .catch(err => {
                          alert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
                          setIsLoading(false);
                        });
                      return;
                    }

                    // Обробка prompt
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
                      } else if (item.endpoint.includes('check-client-state')) {
                        handleEndpoint(
                          `${item.endpoint}?altegioClientId=${encodeURIComponent(input.trim())}`,
                          item.method
                        );
                      } else if (item.endpoint.includes('test-start-command')) {
                        handleEndpoint(
                          `${item.endpoint}?username=${encodeURIComponent(input.trim())}`,
                          item.method
                        );
                      } else if (item.endpoint.includes('check-telegram-webhook') && item.method === 'POST') {
                        if (typeof window !== 'undefined') {
                          const currentUrl = window.location.origin;
                          const webhookUrl = `${currentUrl}/api/telegram/direct-reminders-webhook`;
                          handleEndpoint(
                            item.endpoint,
                            item.method,
                            item.confirm,
                            item.successMessage,
                            { url: webhookUrl }
                          );
                        }
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
                      key={`${categoryIndex}-${itemIndex}`}
                      className="flex flex-col items-center justify-center p-2 border border-blue-500 rounded-lg bg-white hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[60px] relative"
                      onClick={handleClick}
                      disabled={isLoading}
                      title={item.confirm || item.prompt || item.label}
                    >
                      <div className="absolute top-1 left-1 text-[10px] text-gray-500 font-bold">{globalIndex}</div>
                      <div className="text-2xl mb-1">{item.icon}</div>
                      <div className="text-[10px] text-center text-blue-700 font-medium leading-tight px-1">
                        {item.label}
                      </div>
                    </button>
                  );
                })
            )}
          </div>
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
