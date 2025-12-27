// web/app/admin/direct/page.tsx
// Сторінка для роботи дірект-менеджера з клієнтами Instagram Direct

"use client";

import { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import React from "react";
import { DirectClientTable } from "./_components/DirectClientTable";
import { StatusManager } from "./_components/StatusManager";
import { MasterManager } from "./_components/MasterManager";
import { DirectStats } from "./_components/DirectStats";
import type { DirectClient, DirectStatus, DirectStats as DirectStatsType } from "@/lib/direct-types";

// Компонент для діагностичного модального вікна з кнопкою копіювання
function DiagnosticModal({ message, onClose }: { message: string; onClose: () => void }) {
  const handleCopy = async () => {
    try {
      // Використовуємо сучасний Clipboard API
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(message);
        showSuccessMessage('✅ Скопійовано!');
      } else {
        // Fallback для старих браузерів
        const textarea = document.createElement('textarea');
        textarea.value = message;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        
        const copied = document.execCommand('copy');
        document.body.removeChild(textarea);
        
        if (copied) {
          showSuccessMessage('✅ Скопійовано!');
        } else {
          showSuccessMessage('❌ Не вдалося скопіювати');
        }
      }
    } catch (err) {
      showSuccessMessage('❌ Помилка копіювання');
    }
  };

  const showSuccessMessage = (text: string) => {
    const successMsg = document.createElement('div');
    successMsg.textContent = text;
    successMsg.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #10b981; color: white; padding: 12px 24px; border-radius: 8px; z-index: 10000; font-weight: bold; box-shadow: 0 4px 6px rgba(0,0,0,0.1);';
    document.body.appendChild(successMsg);
    setTimeout(() => {
      if (document.body.contains(successMsg)) {
        document.body.removeChild(successMsg);
      }
    }, 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
      }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-lg">Діагностика</h3>
            <button
              className="btn btn-sm btn-circle btn-ghost"
              onClick={onClose}
            >
              ✕
            </button>
          </div>
          <pre className="bg-gray-100 p-4 rounded text-xs overflow-x-auto whitespace-pre-wrap font-mono">
            {message}
          </pre>
        </div>
        <div className="p-4 border-t flex justify-end gap-2">
          <button
            className="btn btn-sm btn-primary"
            onClick={handleCopy}
          >
            📋 Копіювати
          </button>
          <button
            className="btn btn-sm"
            onClick={onClose}
          >
            Закрити
          </button>
        </div>
      </div>
    </div>
  );
}

// Функція для показу alert з можливістю копіювання
function showCopyableAlert(message: string) {
  // Створюємо модальне вікно
  const modalContainer = document.createElement('div');
  modalContainer.id = 'diagnostic-modal-container';
  document.body.appendChild(modalContainer);
  
  // Рендеримо React компонент
  const root = document.createElement('div');
  modalContainer.appendChild(root);
  
  const reactRoot = createRoot(root);
  reactRoot.render(
    React.createElement(DiagnosticModal, {
      message,
      onClose: () => {
        reactRoot.unmount();
        if (document.body.contains(modalContainer)) {
          document.body.removeChild(modalContainer);
        }
      },
    })
  );
}

type DirectMaster = {
  id: string;
  name: string;
  telegramUsername?: string;
  role: 'master' | 'direct-manager' | 'admin';
  altegioStaffId?: number;
  isActive: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
};

export default function DirectPage() {
  const [clients, setClients] = useState<DirectClient[]>([]);
  const [statuses, setStatuses] = useState<DirectStatus[]>([]);
  const [masters, setMasters] = useState<DirectMaster[]>([]);
  const [stats, setStats] = useState<DirectStatsType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    statusId: "",
    masterId: "",
    source: "",
    search: "",
  });
  const [sortBy, setSortBy] = useState<string>("firstContactDate");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Завантажуємо статуси
      const statusesRes = await fetch("/api/admin/direct/statuses");
      if (statusesRes.ok) {
        const statusesData = await statusesRes.json();
        if (statusesData.ok) {
          setStatuses(statusesData.statuses);
        }
      }

      // Завантажуємо відповідальних (майстрів)
      const mastersRes = await fetch("/api/admin/direct/masters");
      if (mastersRes.ok) {
        const mastersData = await mastersRes.json();
        if (mastersData.ok) {
          setMasters(mastersData.masters);
        }
      }

      // Завантажуємо клієнтів
      await loadClients();

      // Завантажуємо статистику
      await loadStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const loadClients = async () => {
    try {
      const params = new URLSearchParams();
      if (filters.statusId) params.set("statusId", filters.statusId);
      if (filters.masterId) params.set("masterId", filters.masterId);
      if (filters.source) params.set("source", filters.source);
      params.set("sortBy", sortBy);
      params.set("sortOrder", sortOrder);

      const res = await fetch(`/api/admin/direct/clients?${params.toString()}`);
      const data = await res.json();
      if (data.ok) {
        let filteredClients = data.clients;

        // Пошук по Instagram username та Повне ім'я
        if (filters.search) {
          const searchLower = filters.search.toLowerCase();
          filteredClients = filteredClients.filter((c: DirectClient) => {
            // Пошук по Instagram username
            const matchesInstagram = c.instagramUsername.toLowerCase().includes(searchLower);
            
            // Пошук по окремих частинах імені
            const matchesFirstName = c.firstName?.toLowerCase().includes(searchLower) || false;
            const matchesLastName = c.lastName?.toLowerCase().includes(searchLower) || false;
            
            // Пошук по повному імені (firstName + lastName разом)
            const fullName = [c.firstName, c.lastName].filter(Boolean).join(' ').toLowerCase();
            const matchesFullName = fullName.includes(searchLower);
            
            return matchesInstagram || matchesFirstName || matchesLastName || matchesFullName;
          });
        }

        setClients(filteredClients);
      } else {
        setError(data.error || "Failed to load clients");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadStats = async () => {
    try {
      const res = await fetch("/api/admin/direct/stats");
      const data = await res.json();
      if (data.ok) {
        setStats(data.stats);
      }
    } catch (err) {
      console.error("Failed to load stats:", err);
    }
  };

  useEffect(() => {
    loadClients();
  }, [filters, sortBy, sortOrder]);

  // Автоматичне оновлення даних кожні 10 секунд
  useEffect(() => {
    const interval = setInterval(() => {
      loadClients();
      loadStats();
    }, 10000); // 10 секунд

    return () => clearInterval(interval);
  }, []);

  const handleClientUpdate = async (clientId: string, updates: Partial<DirectClient>) => {
    try {
      const res = await fetch(`/api/admin/direct/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.ok) {
        await loadClients();
        await loadStats();
      } else {
        alert(data.error || "Failed to update client");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleStatusCreated = async () => {
    await loadData();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="loading loading-spinner loading-lg"></div>
          <p className="mt-4 text-gray-600">Завантаження...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-4 py-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Direct Manager</h1>
          <p className="text-sm text-gray-600 mt-1">
            Робота з клієнтами Instagram Direct
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              setIsLoading(true);
              loadData();
            }}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <span className="loading loading-spinner loading-xs"></span>
                Оновлення...
              </>
            ) : (
              "🔄 Оновити"
            )}
          </button>
          <button
            className="btn btn-sm btn-secondary"
            onClick={async () => {
              if (!confirm('Синхронізувати клієнтів з KeyCRM? Це може зайняти деякий час.')) {
                return;
              }
              setIsLoading(true);
              try {
                // Для тесту: max_clients: 10, для повної синхронізації: max_pages: 0
                const testMode = confirm('Тестовий режим (10 клієнтів)?\n\nOK - тест на 10 клієнтах\nСкасувати - повна синхронізація');
                const syncParams = testMode 
                  ? { max_clients: 10 } 
                  : { max_pages: 0 }; // 0 = синхронізувати всіх (до 100 сторінок)
                
                const res = await fetch('/api/admin/direct/sync-keycrm', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(syncParams),
                });
                const data = await res.json();
                if (data.ok) {
                  const message = data.message || `Синхронізовано: ${data.stats.syncedClients} клієнтів з ${data.stats.totalCards} карток`;
                  if (data.stats.finalIndexLength !== undefined) {
                    alert(`${message}\n\nІндекс містить: ${data.stats.finalIndexLength} записів`);
                  } else {
                    alert(message);
                  }
                  
                  // Затримка перед оновленням, щоб KV встиг оновитися (eventual consistency)
                  // Спробуємо оновити кілька разів з затримками
                  for (let attempt = 1; attempt <= 3; attempt++) {
                    await new Promise(resolve => setTimeout(resolve, attempt * 2000)); // 2s, 4s, 6s
                    await loadData();
                    
                    // Якщо клієнти з'явилися, припиняємо спроби
                    const checkRes = await fetch('/api/admin/direct/clients');
                    const checkData = await checkRes.json();
                    if (checkData.ok && checkData.clients && checkData.clients.length > 0) {
                      console.log(`[direct] Clients loaded after ${attempt} attempt(s)`);
                      break;
                    }
                  }
                } else {
                  alert(`Помилка: ${data.error}`);
                }
              } catch (err) {
                alert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
          >
            🔗 Синхронізувати з KeyCRM
          </button>
          <button
            className="btn btn-sm btn-secondary"
            onClick={async () => {
              if (!confirm('Завантажити клієнтів з Altegio? Це може зайняти деякий час.')) {
                return;
              }
              setIsLoading(true);
              try {
                const testMode = confirm('Тестовий режим (50 клієнтів)?\n\nOK - тест на 50 клієнтах\nСкасувати - повна синхронізація');
                const syncParams = testMode 
                  ? { max_clients: 50, page_size: 50 } 
                  : { page_size: 100 }; // Повна синхронізація
                
                const res = await fetch('/api/admin/direct/sync-altegio-bulk', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(syncParams),
                });
                const data = await res.json();
                if (data.ok) {
                  const message = data.message || `Синхронізовано: ${data.stats.totalCreated} створено, ${data.stats.totalUpdated} оновлено`;
                  alert(`${message}\n\nОброблено: ${data.stats.totalProcessed} клієнтів\nПропущено (немає Instagram): ${data.stats.totalSkippedNoInstagram}`);
                  
                  // Затримка перед оновленням, щоб KV встиг оновитися (eventual consistency)
                  for (let attempt = 1; attempt <= 3; attempt++) {
                    await new Promise(resolve => setTimeout(resolve, attempt * 2000)); // 2s, 4s, 6s
                    await loadData();
                    
                    const checkRes = await fetch('/api/admin/direct/clients');
                    const checkData = await checkRes.json();
                    if (checkData.ok && checkData.clients && checkData.clients.length > 0) {
                      console.log(`[direct] Clients loaded after ${attempt} attempt(s)`);
                      break;
                    }
                  }
                } else {
                  alert(`Помилка: ${data.error}`);
                }
              } catch (err) {
                alert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
          >
            📥 Завантажити з Altegio
          </button>

          <button
            className="btn btn-sm btn-secondary"
            onClick={async () => {
              const clientId = prompt('Введіть Altegio Client ID для тестування (наприклад, 176404915):');
              if (!clientId) return;
              
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/test-altegio-client', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ client_id: clientId }),
                });
                const data = await res.json();
                if (data.ok) {
                  showCopyableAlert(JSON.stringify(data, null, 2));
                } else {
                  showCopyableAlert(`Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
          >
            🧪 Тест клієнта Altegio
          </button>
          <button
            className="btn btn-sm btn-secondary"
            onClick={async () => {
              const clientId = prompt('Введіть Altegio Client ID для тестування вебхука (наприклад, 176404915):');
              if (!clientId) return;
              
              const format = prompt('Виберіть формат custom_fields:\n1. array_title_value (масив з title/value)\n2. array_name_value (масив з name/value)\n3. object_keys (об\'єкт з ключами)\n4. object_camel (camelCase)\n5. object_spaces (з пробілами)\n\nВведіть номер (1-5) або залиште порожнім для array_title_value:');
              
              const formatMap: Record<string, string> = {
                '1': 'array_title_value',
                '2': 'array_name_value',
                '3': 'object_keys',
                '4': 'object_camel',
                '5': 'object_spaces',
              };
              
              const customFieldsFormat = format && formatMap[format] ? formatMap[format] : 'array_title_value';
              
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/test-altegio-webhook', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ clientId, customFieldsFormat }),
                });
                const data = await res.json();
                if (data.ok) {
                  const message = `Тест вебхука:\n\n` +
                    `Клієнт ID: ${data.test.clientId}\n` +
                    `Формат: ${data.test.customFieldsFormat}\n` +
                    `Instagram витягнуто: ${data.extraction.instagram || '❌ НЕ ВИТЯГНУТО'}\n` +
                    `Вебхук відповідь: ${data.webhook.response?.ok ? '✅ OK' : '❌ Помилка'}\n` +
                    `\nДеталі витягування:\n${JSON.stringify(data.extraction.steps, null, 2)}\n\n` +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                } else {
                  showCopyableAlert(`Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
          >
            🔗 Тест вебхука Altegio
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={async () => {
              try {
                const res = await fetch('/api/altegio/webhook?limit=20');
                const data = await res.json();
                if (data.ok) {
                  const clientEvents = data.lastClientEvents || [];
                  const message = `Останні вебхуки Altegio:\n\n` +
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
                  showCopyableAlert(message);
                } else {
                  showCopyableAlert(`Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              }
            }}
            title="Переглянути останні події вебхука від Altegio"
          >
            📋 Останні вебхуки
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={async () => {
              // Запитуємо Instagram username або ім'я клієнтки
              const input = prompt('Введіть Instagram username (наприклад: @tania.pidgaina) або повне ім\'я клієнтки (наприклад: таня підгайна):');
              if (!input || !input.trim()) {
                return;
              }
              
              try {
                const searchTerm = input.trim();
                // Визначаємо, чи це Instagram username чи ім'я
                const isInstagram = searchTerm.startsWith('@') || searchTerm.includes('_') || /^[a-z0-9._]+$/i.test(searchTerm);
                
                const res = await fetch('/api/admin/direct/diagnose-client', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(
                    isInstagram
                      ? { instagramUsername: searchTerm.replace('@', '') }
                      : { fullName: searchTerm }
                  ),
                });
                const data = await res.json();
                if (data.ok) {
                  const diagnosis = data.diagnosis;
                  let message = `🔍 Діагностика клієнтки: ${searchTerm}\n\n`;
                  
                  if (diagnosis.directClient) {
                    message += `✅ Клієнтка знайдена в Direct Manager\n`;
                    message += `   ID: ${diagnosis.directClient.id}\n`;
                    message += `   Instagram: ${diagnosis.directClient.instagramUsername}\n`;
                    message += `   Ім'я: ${diagnosis.directClient.fullName || 'не вказано'}\n`;
                    message += `   Стан: ${diagnosis.directClient.state || 'не встановлено'}\n`;
                    message += `   Altegio ID: ${diagnosis.directClient.altegioClientId || 'немає'}\n`;
                    message += `   Джерело: ${diagnosis.directClient.source || 'не вказано'}\n\n`;
                  } else {
                    message += `❌ Клієнтка не знайдена в Direct Manager\n\n`;
                  }
                  
                  if (diagnosis.issues && diagnosis.issues.length > 0) {
                    message += `Проблеми:\n${diagnosis.issues.map((i: string) => `  ${i}`).join('\n')}\n\n`;
                  }
                  
                  if (diagnosis.recommendations && diagnosis.recommendations.length > 0) {
                    message += `Рекомендації:\n${diagnosis.recommendations.map((r: string) => `  ${r}`).join('\n')}\n\n`;
                  }
                  
                  if (diagnosis.records) {
                    message += `Записи в Altegio:\n`;
                    message += `  Всього: ${diagnosis.records.total}\n`;
                    message += `  З "Консультація": ${diagnosis.records.withConsultation}\n`;
                    message += `  З "Нарощування волосся": ${diagnosis.records.withHairExtension}\n`;
                    if (diagnosis.records.latest && diagnosis.records.latest.length > 0) {
                      message += `\n  Останні записи:\n`;
                      diagnosis.records.latest.forEach((r: any, idx: number) => {
                        message += `    ${idx + 1}. ${r.receivedAt} - ${r.status}\n`;
                        message += `       Послуги: ${r.services.join(', ')}\n`;
                        message += `       Консультація: ${r.hasConsultation ? '✅' : '❌'}\n`;
                      });
                    }
                    message += `\n`;
                  }
                  
                  if (diagnosis.webhooks) {
                    message += `Вебхуки:\n`;
                    message += `  Всього: ${diagnosis.webhooks.total}\n`;
                    message += `  Записи: ${diagnosis.webhooks.records}\n`;
                    message += `  Клієнти: ${diagnosis.webhooks.clients}\n`;
                    if (diagnosis.webhooks.latest && diagnosis.webhooks.latest.length > 0) {
                      message += `\n  Останні вебхуки:\n`;
                      diagnosis.webhooks.latest.forEach((w: any, idx: number) => {
                        message += `    ${idx + 1}. ${w.receivedAt} - ${w.resource} (${w.status})\n`;
                        if (w.services && w.services.length > 0) {
                          message += `       Послуги: ${w.services.join(', ')}\n`;
                        }
                      });
                    }
                    message += `\n`;
                  }
                  
                  message += `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  
                  showCopyableAlert(message);
                  console.log('Client Diagnosis:', data);
                } else {
                  showCopyableAlert(`Помилка діагностики: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                alert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              }
            }}
            title="Діагностика конкретної клієнтки (введіть Instagram username або ім'я)"
          >
            🔍 Діагностика
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={async () => {
              try {
                const res = await fetch('/api/admin/direct/test-kv');
                const data = await res.json();
                console.log('KV Test Results:', data);
                const test = data.results?.writeTest;
                const index = data.results?.index;
                const message = `Тест KV:\nЗапис: ${test?.success ? '✅' : '❌'}\nІндекс існує: ${index?.exists ? '✅' : '❌'}\nТип індексу: ${index?.type}\n\nДеталі в консолі (F12)\n\nJSON:\n${JSON.stringify(data, null, 2)}`;
                showCopyableAlert(message);
              } catch (err) {
                alert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              }
            }}
            title="Тест запису/читання KV"
          >
            🧪 Тест KV
          </button>
          <button
            className="btn btn-sm btn-success"
            onClick={async () => {
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/recover-client', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                  const message = `✅ ${data.message}\n\nЗнайдено через getAllDirectClients: ${data.stats.foundViaGetAll}\nЗнайдено через Instagram index: ${data.stats.foundViaInstagram}\nВсього в індексі: ${data.stats.totalInIndex}\n\nJSON:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                  await loadData();
                } else {
                  showCopyableAlert(`❌ ${data.message || data.error || 'Помилка відновлення'}\n\nJSON:\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                alert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Відновити втраченого клієнта в індекс"
          >
            🔄 Відновити клієнта
          </button>
          <button
            className="btn btn-sm btn-warning"
            onClick={async () => {
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/check-migration');
                const data = await res.json();
                if (data.ok) {
                  const migration = data.migration;
                  const message = `Перевірка міграції:\n\n` +
                    `Статус: ${migration.status}\n` +
                    `Міграція виконана: ${migration.isMigrated ? '✅' : '❌'}\n\n` +
                    `Postgres:\n` +
                    `  Підключено: ${migration.postgres.connected ? '✅' : '❌'}\n` +
                    `  Клієнтів: ${migration.postgres.clientsCount}\n` +
                    `  Статусів: ${migration.postgres.statusesCount}\n` +
                    (migration.postgres.error ? `  Помилка: ${migration.postgres.error}\n` : '') +
                    `\nKV (старий store):\n` +
                    `  Клієнтів: ${migration.kv.clientsCount}\n` +
                    `  Статусів: ${migration.kv.statusesCount}\n` +
                    `\nStore (новий, через Postgres):\n` +
                    `  Клієнтів: ${migration.store.clientsCount}\n` +
                    `  Статусів: ${migration.store.statusesCount}\n` +
                    (migration.store.error ? `  Помилка: ${migration.store.error}\n` : '') +
                    `\nРекомендація: ${migration.recommendation}\n\n` +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                } else {
                  showCopyableAlert(`Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Перевірити стан міграції на Postgres"
          >
            🗄️ Перевірити міграцію
          </button>
          <button
            className="btn btn-sm btn-success"
            onClick={async () => {
              const instagram = prompt('Введіть Instagram username (наприклад, lizixxss):');
              if (!instagram) return;
              
              const fullName = prompt('Введіть повне ім\'я (необов\'язково):');
              let firstName: string | undefined;
              let lastName: string | undefined;
              if (fullName) {
                const parts = fullName.trim().split(' ');
                firstName = parts[0] || undefined;
                lastName = parts.slice(1).join(' ') || undefined;
              }
              
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/add-client', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    instagramUsername: instagram,
                    firstName,
                    lastName,
                    source: 'instagram',
                  }),
                });
                const data = await res.json();
                if (data.ok) {
                  const message = `${data.created ? '✅ Клієнт створено' : '✅ Клієнт оновлено'}!\n\n` +
                    `Instagram: ${data.client.instagramUsername}\n` +
                    `Ім'я: ${data.client.firstName || '—'} ${data.client.lastName || ''}\n` +
                    `ID: ${data.client.id}\n` +
                    `Статус: ${data.client.statusId}\n` +
                    `Стан: ${data.client.state || '—'}\n\n` +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                  await loadData();
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Додати клієнта вручну"
          >
            ➕ Додати клієнта
          </button>
          <button
            className="btn btn-sm btn-info"
            onClick={async () => {
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/test-status-save', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                  const test = data.test;
                  const summary = test.summary;
                  const message = `Тест збереження статусу:\n\n` +
                    `Статус збережено в KV: ${summary.saved ? '✅' : '❌'}\n` +
                    `Статус в індексі: ${summary.inIndex ? '✅' : '❌'}\n` +
                    `Статус в getAllDirectStatuses: ${summary.inGetAll ? '✅' : '❌'}\n` +
                    `Індекс збільшився: ${summary.indexIncreased ? '✅' : '❌'}\n\n` +
                    `Деталі в консолі (F12)\n\n` +
                    `JSON:\n${JSON.stringify(data.test, null, 2)}`;
                  console.log('Status Save Test Results:', data.test);
                  showCopyableAlert(message);
                } else {
                  showCopyableAlert(`Помилка: ${data.error || 'Unknown error'}\n\nJSON:\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Тест збереження статусу"
          >
            🧪 Тест статусу
          </button>
          <button
            className="btn btn-sm btn-error"
            onClick={async () => {
              if (!confirm('Створити таблиці в Postgres (Prisma міграція)?\n\nЦе створить таблиці:\n- direct_clients\n- direct_statuses\n- direct_masters\n\nПродовжити?')) {
                return;
              }
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/run-migration', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                  const message = `✅ Міграція виконана!\n\n${data.results}\n\nПовна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                } else {
                  showCopyableAlert(`❌ Помилка міграції: ${data.error || 'Невідома помилка'}\n\n${data.results || ''}\n\nПовна відповідь:\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Створити таблиці в Postgres (Prisma міграція)"
          >
            🗄️ Створити таблиці
          </button>
          <button
            className="btn btn-sm btn-success"
            onClick={async () => {
              if (!confirm('Оновити стани всіх клієнтів на основі записів з Altegio?\n\nЦе перевірить всі записи з Altegio і оновить стани клієнтів:\n- "Консультація" - якщо є послуга "Консультація"\n- "Нарощування волосся" - якщо є послуга з "Нарощування волосся"\n\nПродовжити?')) {
                return;
              }
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/update-states-from-records', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                  const message = `✅ Оновлення станів завершено!\n\n` +
                    `Всього клієнтів: ${data.stats.totalClients}\n` +
                    `Оновлено: ${data.stats.updated}\n` +
                    `Пропущено: ${data.stats.skipped}\n` +
                    `Помилок: ${data.stats.errors}\n\n` +
                    (data.errors.length > 0
                      ? `Перші помилки:\n${data.errors.slice(0, 5).join('\n')}\n\n`
                      : ''
                    ) +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                  await loadData();
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Оновити стани всіх клієнтів на основі записів з Altegio"
          >
            🔄 Оновити стани
          </button>

          <button
            className="btn btn-sm btn-secondary"
            onClick={async () => {
              if (!confirm('Виправити пропущені консультації в історії станів для всіх клієнтів з нарощуванням?\n\nЦе знайде клієнтів зі станом "Нарощування волосся", у яких немає консультації в історії, але в записах Altegio є обидві послуги, і додасть консультацію в історію.\n\nПродовжити?')) {
                return;
              }
              
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/fix-missing-consultations', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                  const message = `✅ Виправлення завершено!\n\n` +
                    `Всього клієнтів перевірено: ${data.stats.totalClients}\n` +
                    `Виправлено: ${data.stats.fixed}\n` +
                    `Пропущено: ${data.stats.skipped}\n` +
                    (data.stats.errors > 0 ? `Помилок: ${data.stats.errors}\n\n` : '\n') +
                    (data.errors.length > 0
                      ? `Перші помилки:\n${data.errors.slice(0, 5).join('\n')}\n\n`
                      : ''
                    ) +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                  await loadData();
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Виправити пропущені консультації в історії станів"
          >
            🔧 Виправити пропущені консультації
          </button>

          <button
            className="btn btn-sm btn-info"
            onClick={async () => {
              const type = confirm('Надіслати повторне нагадування?\n\nНатисніть OK для повторного нагадування (Недодзвон)\nНатисніть Скасувати для нового нагадування') ? 'repeat' : 'new';
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/test-reminder', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ type }),
                });
                const data = await res.json();
                if (data.ok) {
                  const message = `✅ ${data.message}\n\n` +
                    `Тип: ${type === 'repeat' ? 'Повторне нагадування' : 'Нове нагадування'}\n` +
                    `Клієнт: ${data.reminder.clientName}\n` +
                    `Телефон: ${data.reminder.phone}\n` +
                    `Instagram: @${data.reminder.instagramUsername}\n` +
                    `Послуга: ${data.reminder.serviceName}\n\n` +
                    `Перевірте Telegram для отримання повідомлення з кнопками.\n\n` +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Протестувати надсилання нагадування в Telegram з кнопками"
          >
            📱 Тест нагадування
          </button>
          <button
            className="btn btn-sm btn-info btn-outline"
            onClick={async () => {
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/test-reminder-debug');
                const data = await res.json();
                if (data.ok) {
                  const message = `🔍 Діагностика налаштувань нагадувань\n\n` +
                    `Токени:\n` +
                    `  TELEGRAM_BOT_TOKEN (фото-бот): ${data.debug.tokens.TELEGRAM_BOT_TOKEN}\n` +
                    `  TELEGRAM_HOB_CLIENT_BOT_TOKEN: ${data.debug.tokens.TELEGRAM_HOB_CLIENT_BOT_TOKEN}\n` +
                    `  Використовується: ${data.debug.tokens.usingToken}\n\n` +
                    `Chat IDs адміністраторів:\n` +
                    `  З env (TELEGRAM_ADMIN_CHAT_IDS): ${data.debug.adminChatIds.fromEnv.length > 0 ? data.debug.adminChatIds.fromEnv.join(', ') : 'не встановлено'}\n` +
                    `  З реєстру майстрів: ${data.debug.adminChatIds.fromRegistry.length > 0 ? data.debug.adminChatIds.fromRegistry.join(', ') : 'не знайдено'}\n` +
                    `  Всього: ${data.debug.adminChatIds.total.length} (${data.debug.adminChatIds.total.join(', ')})\n\n` +
                    `Chat ID Миколая: ${data.debug.mykolayChatId || 'не знайдено'}\n\n` +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Діагностика налаштувань нагадувань"
          >
            🔍 Діагностика нагадувань
          </button>
          <button
            className="btn btn-sm btn-info"
            onClick={async () => {
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/check-data');
                const data = await res.json();
                if (data.ok) {
                  const message = `📊 Діагностика даних:\n\n` +
                    `Postgres:\n` +
                    `  Клієнти: ${data.summary.postgresClients}\n` +
                    `  Статуси: ${data.summary.postgresStatuses}\n` +
                    `  Відповідальні: ${data.summary.postgresMasters}\n` +
                    `  SQL count: ${data.summary.directSqlCount}\n\n` +
                    `KV:\n` +
                    `  Клієнти: ${data.summary.kvClients}\n` +
                    `  Статуси: ${data.summary.kvStatuses}\n\n` +
                    `Рекомендація: ${data.recommendation}\n\n` +
                    (data.details.postgres.clients.sample && data.details.postgres.clients.sample.length > 0
                      ? `Приклади клієнтів:\n${data.details.postgres.clients.sample.map((c: any) => `  - ${c.username} (${c.name || 'без імені'})`).join('\n')}\n\n`
                      : ''
                    ) +
                    (data.details.postgres.clients.error
                      ? `Помилка клієнтів: ${data.details.postgres.clients.error}\n\n`
                      : ''
                    ) +
                    (data.details.postgres.statuses.error
                      ? `Помилка статусів: ${data.details.postgres.statuses.error}\n\n`
                      : ''
                    ) +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Перевірити наявність даних в Postgres та KV"
          >
            🔍 Перевірити дані
          </button>
          <button
            className="btn btn-sm btn-accent"
            onClick={async () => {
              if (!confirm('Виконати міграцію даних з KV → Postgres?\n\nЦе перенесе всіх клієнтів та статуси з KV в Postgres.\n\nПродовжити?')) {
                return;
              }
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/migrate-data', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                  const message = `✅ Міграція завершена!\n\n` +
                    `Статуси:\n` +
                    `  Знайдено: ${data.stats.statuses.found}\n` +
                    `  Мігровано: ${data.stats.statuses.migrated}\n` +
                    `  Помилок: ${data.stats.statuses.errors}\n` +
                    `  Всього в Postgres: ${data.stats.statuses.finalCount}\n\n` +
                    `Клієнти:\n` +
                    `  Знайдено: ${data.stats.clients.found}\n` +
                    `  Мігровано: ${data.stats.clients.migrated}\n` +
                    `  Помилок: ${data.stats.clients.errors}\n\n` +
                    (data.errors.statuses.length > 0 || data.errors.clients.length > 0
                      ? `Помилки:\n${JSON.stringify(data.errors, null, 2)}\n\n`
                      : ''
                    ) +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                  await loadData();
                } else {
                  showCopyableAlert(`❌ Помилка міграції: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Мігрувати дані з KV в Postgres"
          >
            🚀 Мігрувати дані
          </button>
          <button
            className="btn btn-sm btn-warning"
            onClick={async () => {
              // Спочатку показуємо попередній перегляд
              try {
                const previewRes = await fetch('/api/admin/direct/cleanup-altegio-generated');
                const previewData = await previewRes.json();
                if (previewData.ok) {
                  const count = previewData.stats?.toDelete || 0;
                  if (count === 0) {
                    alert('✅ Немає клієнтів для видалення');
                    return;
                  }
                  
                  const confirmMessage = `Знайдено ${count} клієнтів з Altegio, які мають згенерований Instagram username (починається з "altegio_").\n\nВидалити їх?`;
                  if (!confirm(confirmMessage)) {
                    return;
                  }
                  
                  setIsLoading(true);
                  try {
                    const res = await fetch('/api/admin/direct/cleanup-altegio-generated', { method: 'POST' });
                    const data = await res.json();
                    if (data.ok) {
                      const message = `✅ ${data.message}\n\n` +
                        `Всього клієнтів: ${data.stats.totalClients}\n` +
                        `Знайдено для видалення: ${data.stats.foundToDelete}\n` +
                        `Видалено: ${data.stats.deleted}\n` +
                        `Помилки: ${data.stats.errors}\n\n` +
                        `Деталі:\n${JSON.stringify(data.deletedClients?.slice(0, 10) || [], null, 2)}\n\n` +
                        `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                      showCopyableAlert(message);
                      await loadData();
                    } else {
                      showCopyableAlert(`Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                    }
                  } catch (err) {
                    showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
                  } finally {
                    setIsLoading(false);
                  }
                } else {
                  showCopyableAlert(`Помилка перегляду: ${previewData.error || 'Невідома помилка'}\n\n${JSON.stringify(previewData, null, 2)}`);
                }
              } catch (err) {
                alert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              }
            }}
            disabled={isLoading}
            title="Видалити клієнтів з Altegio, які мають згенерований Instagram username"
          >
            🗑️ Очистити згенеровані
          </button>
          <button
            className="btn btn-sm btn-warning"
            onClick={async () => {
              if (!confirm('Відновити індекс клієнтів? Це перебудує індекс з усіх збережених клієнтів.')) {
                return;
              }
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/rebuild-index', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                  alert(data.message || `Індекс відновлено: ${data.stats?.afterRebuild || 0} клієнтів`);
                  // Оновлюємо дані
                  setTimeout(async () => {
                    await loadData();
                  }, 2000);
                } else {
                  alert(`Помилка: ${data.error}`);
                }
              } catch (err) {
                alert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            title="Відновити індекс клієнтів"
          >
            🔧 Відновити індекс
          </button>
          <button
            className="btn btn-sm btn-success"
            onClick={async () => {
              if (!confirm('Відновити всі дані з KV в Postgres?\n\nЦе знайде всіх клієнтів та статуси в KV і перенесе їх в Postgres.\n\nПродовжити?')) {
                return;
              }
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/recover-all-data', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                  const message = `✅ Відновлення даних завершено!\n\n` +
                    `Статуси:\n` +
                    `  Знайдено в KV: ${data.stats.statuses.foundInKV}\n` +
                    `  Було в Postgres: ${data.stats.statuses.foundInPostgres}\n` +
                    `  Мігровано: ${data.stats.statuses.migrated}\n` +
                    `  Помилок: ${data.stats.statuses.errors}\n` +
                    `  Всього в Postgres: ${data.stats.final.statuses}\n\n` +
                    `Клієнти:\n` +
                    `  Знайдено в KV: ${data.stats.clients.foundInKV}\n` +
                    `  Було в Postgres: ${data.stats.clients.foundInPostgres}\n` +
                    `  Мігровано: ${data.stats.clients.migrated}\n` +
                    `  Помилок: ${data.stats.clients.errors}\n` +
                    `  Всього в Postgres: ${data.stats.final.clients}\n\n` +
                    (data.errors.statuses.length > 0 || data.errors.clients.length > 0
                      ? `Помилки:\n${[...data.errors.statuses, ...data.errors.clients].slice(0, 5).join('\n')}\n\n`
                      : ''
                    ) +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                  await loadData();
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Відновити всі дані з KV в Postgres"
          >
            🔄 Відновити дані з KV
          </button>
          <button
            className="btn btn-sm btn-warning"
            onClick={async () => {
              if (!confirm('Мігрувати майстрів з mock-data в базу даних?\n\nЦе перенесе всіх майстрів з фото-звітів в нову базу даних.')) {
                return;
              }
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/migrate-masters', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                  const message = `✅ Міграція майстрів завершена!\n\n` +
                    `Знайдено: ${data.stats.found}\n` +
                    `Мігровано: ${data.stats.migrated}\n` +
                    `Пропущено: ${data.stats.skipped}\n` +
                    `Помилок: ${data.stats.errors}\n` +
                    `Всього в базі: ${data.stats.finalCount}\n\n` +
                    (data.errors.length > 0
                      ? `Помилки:\n${data.errors.join('\n')}\n\n`
                      : ''
                    ) +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                  await loadData();
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Мігрувати майстрів з mock-data в базу даних"
          >
            👥 Мігрувати майстрів
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
          <button
            className="btn btn-sm btn-ghost ml-4"
            onClick={() => {
              setError(null);
              loadData();
            }}
          >
            Оновити
          </button>
        </div>
      )}

      {/* Статистика */}
      {stats && <DirectStats stats={stats} />}

      {/* Управління статусами та відповідальними */}
      <div className="flex gap-4 items-start">
        <div className="flex-1">
          <StatusManager
            statuses={statuses}
            onStatusCreated={handleStatusCreated}
          />
        </div>
        <div className="flex-1">
          <MasterManager
            masters={masters}
            onMasterUpdated={handleStatusCreated}
          />
        </div>
      </div>

      {/* Таблиця клієнтів */}
      <DirectClientTable
        clients={clients}
        statuses={statuses}
        filters={filters}
        onFiltersChange={setFilters}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={(by, order) => {
          setSortBy(by);
          setSortOrder(order);
        }}
        onClientUpdate={handleClientUpdate}
        onRefresh={loadData}
      />
    </div>
  );
}
