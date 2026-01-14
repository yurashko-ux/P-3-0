// web/app/admin/direct/_components/DirectClientTable.tsx
// Таблиця клієнтів Direct

"use client";

import { useState, useEffect, useMemo } from "react";
import type { DirectClient, DirectStatus } from "@/lib/direct-types";
import { ClientForm } from "./ClientForm";
import { StateHistoryModal } from "./StateHistoryModal";
import { MessagesHistoryModal } from "./MessagesHistoryModal";
import { ClientWebhooksModal } from "./ClientWebhooksModal";

// Компонент для відображення піктограми стану
function StateIcon({ state, size = 36 }: { state: string | null; size?: number }) {
  const iconStyle = { width: `${size}px`, height: `${size}px` };
  
  if (state === 'client') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={iconStyle}>
        <circle cx="14" cy="10" r="6" fill="#fbbf24" stroke="#f59e0b" strokeWidth="1.5"/>
        <path d="M8 10 Q8 4 14 4 Q20 4 20 10" stroke="#8b5cf6" strokeWidth="3" fill="none" strokeLinecap="round"/>
        <path d="M9 10 Q9 5 14 5 Q19 5 19 10" stroke="#8b5cf6" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
        <path d="M10 10 Q10 6 14 6 Q18 6 18 10" stroke="#8b5cf6" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <circle cx="12" cy="9" r="0.8" fill="#1f2937"/>
        <circle cx="16" cy="9" r="0.8" fill="#1f2937"/>
        <path d="M12 11 Q14 12 16 11" stroke="#1f2937" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
      </svg>
    );
  } else if (state === 'consultation') {
    return (
      <img 
        src="/assets/image-consultation-arrow.png" 
        alt="Консультація" 
        className="object-contain"
        style={iconStyle}
      />
    );
  } else if (state === 'message') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={iconStyle}>
        <path d="M7 14 C7 10.686 9.686 8 13 8 C16.314 8 19 10.686 19 14 C19 17.314 16.314 20 13 20 L7 20 C4.791 20 3 18.209 3 16 C3 13.791 4.791 12 7 12" stroke="#10b981" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <circle cx="10" cy="14" r="1" fill="#10b981"/>
        <circle cx="13" cy="14" r="1" fill="#10b981"/>
        <circle cx="16" cy="14" r="1" fill="#10b981"/>
        <path d="M7 20 L5 22 L7 22 Z" fill="#10b981"/>
      </svg>
    );
  } else if (state === 'consultation-booked') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={iconStyle}>
        <rect x="5" y="6" width="18" height="18" rx="2" fill="#3b82f6" stroke="#2563eb" strokeWidth="1.5"/>
        <path d="M8 4 L8 10 M20 4 L20 10" stroke="#2563eb" strokeWidth="2" strokeLinecap="round"/>
        <path d="M5 12 L23 12" stroke="#2563eb" strokeWidth="1.5"/>
        <circle cx="14" cy="18" r="3" fill="#ffffff"/>
        <path d="M12 18 L13.5 19.5 L16 17" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  } else if (state === 'consultation-no-show') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={iconStyle}>
        <rect x="5" y="6" width="18" height="18" rx="2" fill="#ef4444" stroke="#dc2626" strokeWidth="1.5"/>
        <path d="M8 4 L8 10 M20 4 L20 10" stroke="#dc2626" strokeWidth="2" strokeLinecap="round"/>
        <path d="M5 12 L23 12" stroke="#dc2626" strokeWidth="1.5"/>
        <circle cx="14" cy="18" r="3" fill="#ffffff"/>
        <path d="M11 18 L17 18" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    );
  } else if (state === 'consultation-rescheduled') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={iconStyle}>
        <rect x="5" y="6" width="18" height="18" rx="2" fill="#f59e0b" stroke="#d97706" strokeWidth="1.5"/>
        <path d="M8 4 L8 10 M20 4 L20 10" stroke="#d97706" strokeWidth="2" strokeLinecap="round"/>
        <path d="M5 12 L23 12" stroke="#d97706" strokeWidth="1.5"/>
        <path d="M11 17 L14 14 L17 17 M17 17 L14 20 L11 17" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  } else if (state === 'hair-extension') {
    return (
      <img 
        src="/assets/image-client.png" 
        alt="Нарощування волосся" 
        className="object-contain"
        style={iconStyle}
      />
    );
  } else if (state === 'other-services') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={iconStyle}>
        <path d="M10 6 L10 22 M18 6 L18 22" stroke="#ec4899" strokeWidth="2" strokeLinecap="round"/>
        <circle cx="10" cy="6" r="2" fill="#ec4899"/>
        <circle cx="18" cy="6" r="2" fill="#ec4899"/>
        <path d="M10 8 Q14 10 18 8" stroke="#ec4899" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <path d="M10 12 Q14 14 18 12" stroke="#ec4899" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
        <rect x="6" y="16" width="16" height="8" rx="1" stroke="#ec4899" strokeWidth="1.5" fill="none"/>
        <circle cx="14" cy="20" r="2" stroke="#ec4899" strokeWidth="1" fill="none"/>
      </svg>
    );
  } else if (state === 'all-good') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={iconStyle}>
        <circle cx="14" cy="14" r="12" fill="#10b981" stroke="#059669" strokeWidth="1.5"/>
        <path d="M8 14 L12 18 L20 10" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  } else if (state === 'too-expensive') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={iconStyle}>
        <circle cx="14" cy="14" r="12" fill="#f59e0b" stroke="#d97706" strokeWidth="1.5"/>
        <path d="M14 8 L14 20" stroke="white" strokeWidth="2" strokeLinecap="round"/>
        <path d="M10 12 L18 12" stroke="white" strokeWidth="2" strokeLinecap="round"/>
        <path d="M10 16 L18 16" stroke="white" strokeWidth="2" strokeLinecap="round"/>
        <circle cx="14" cy="14" r="3" stroke="white" strokeWidth="1.5" fill="none"/>
      </svg>
    );
  } else {
    return (
      <img 
        src="/assets/image-lead.png" 
        alt="Лід" 
        className="object-contain"
        style={iconStyle}
      />
    );
  }
}

type DirectClientTableProps = {
  clients: DirectClient[];
  statuses: DirectStatus[];
  filters: {
    statusId: string;
    masterId: string;
    source: string;
    search: string;
    hasAppointment: string;
  };
  onFiltersChange: (filters: DirectClientTableProps["filters"]) => void;
  onSearchClick?: () => void;
  sortBy: string;
  sortOrder: "asc" | "desc";
  onSortChange: (by: string, order: "asc" | "desc") => void;
  onClientUpdate: (clientId: string, updates: Partial<DirectClient>) => Promise<void>;
  onRefresh: () => Promise<void>;
};

export function DirectClientTable({
  clients,
  statuses,
  filters,
  onFiltersChange,
  onSearchClick,
  sortBy,
  sortOrder,
  onSortChange,
  onClientUpdate,
  onRefresh,
}: DirectClientTableProps) {
  const [editingClient, setEditingClient] = useState<DirectClient | null>(null);
  const [masters, setMasters] = useState<Array<{ id: string; name: string }>>([]);
  const [stateHistoryClient, setStateHistoryClient] = useState<DirectClient | null>(null);
  const [messagesHistoryClient, setMessagesHistoryClient] = useState<DirectClient | null>(null);
  const [webhooksClient, setWebhooksClient] = useState<DirectClient | null>(null);
  const [searchInput, setSearchInput] = useState<string>(filters.search);

  // Синхронізуємо searchInput з filters.search коли filters змінюється ззовні (наприклад, при скиданні)
  useEffect(() => {
    setSearchInput(filters.search);
  }, [filters.search]);

  // Завантажуємо відповідальних (майстрів)
  useEffect(() => {
    fetch("/api/admin/direct/masters?forSelection=true")
      .then((res) => {
        if (!res.ok) {
          console.warn(`[DirectClientTable] Failed to load masters: ${res.status} ${res.statusText}`);
          // Fallback на старий endpoint
          return fetch("/api/photo-reports/masters");
        }
        return res;
      })
      .then((res) => {
        if (!res) return null;
        return res.json();
      })
      .then((data) => {
        if (data && data.ok && data.masters) {
          setMasters(data.masters);
        } else {
          // Якщо endpoint не існує, використовуємо порожній масив
          setMasters([]);
        }
      })
      .catch((err) => {
        console.warn("[DirectClientTable] Failed to load masters (non-critical):", err);
        setMasters([]);
      });
  }, []);

  // НЕ завантажуємо історію станів для всіх клієнтів одразу - це створює зайве навантаження
  // Історія завантажується тільки при відкритті модального вікна (StateHistoryModal)
  // В таблиці показуємо тільки поточний стан клієнта

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "-";
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" });
    } catch {
      return dateStr;
    }
  };

  const getStatusColor = (statusId: string) => {
    const status = statuses.find((s) => s.id === statusId);
    return status?.color || "#6b7280";
  };

  const getFullName = (client: DirectClient) => {
    const isBadNamePart = (v?: string) => {
      if (!v) return true;
      const t = v.trim();
      if (!t) return true;
      // Не показуємо плейсхолдери типу {{full_name}}
      if (t.includes("{{") || t.includes("}}")) return true;
      if (t.toLowerCase() === "not found") return true;
      return false;
    };
    const parts = [client.firstName, client.lastName].filter((p) => !isBadNamePart(p));
    return parts.length ? parts.join(" ") : "-";
  };

  const handleStatusChange = async (client: DirectClient, newStatusId: string) => {
    await onClientUpdate(client.id, { statusId: newStatusId });
  };

  const handleMasterChange = async (client: DirectClient, masterId: string | undefined) => {
    await onClientUpdate(client.id, { masterId, masterManuallySet: true });
  };

  const handleFieldUpdate = async (client: DirectClient, field: keyof DirectClient, value: any) => {
    await onClientUpdate(client.id, { [field]: value });
  };

  // Унікалізуємо клієнтів за instagramUsername, щоб не було дублів
  // ПРИМІТКА: Об'єднання за altegioClientId відбувається на рівні бази даних через endpoint merge-duplicates-by-name
  const uniqueClients = useMemo(() => {
    const map = new Map<string, DirectClient>();

    const normalize = (username: string) => username.trim().toLowerCase();

    for (const client of clients) {
      const key = normalize(client.instagramUsername);
      if (!map.has(key)) {
        map.set(key, client);
      }
    }

    return Array.from(map.values());
  }, [clients]);

  return (
    <div className="space-y-4">
      {/* Фільтри та пошук */}
      <div className="card bg-base-100 shadow-sm">
        <div className="card-body p-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="min-w-[500px]">
              <label className="label label-text text-xs">Пошук</label>
              <div className="flex gap-1 items-center">
                <div className="relative flex-1">
              <input
                type="text"
                    placeholder="Instagram або ім'я..."
                    className="input input-bordered input-sm w-full pr-8"
                    value={searchInput}
                    onChange={(e) => {
                      const newValue = e.target.value;
                      setSearchInput(newValue);
                      // Автоматично оновлюємо фільтр при введенні
                      onFiltersChange({ ...filters, search: newValue });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        // При натисканні Enter також оновлюємо фільтр
                        onFiltersChange({ ...filters, search: searchInput });
                        onSearchClick?.();
                      }
                    }}
                  />
                  {searchInput && (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 btn btn-ghost btn-xs btn-circle"
                      onClick={() => {
                        setSearchInput("");
                        onFiltersChange({ ...filters, search: "" });
                        // При очищенні розблоковуємо пошук, щоб показати всіх клієнтів
                        // onSearchClick?.() тут не потрібен, бо onFiltersChange вже розблоковує при зміні search
                      }}
                      title="Очистити"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => {
                    // При натисканні кнопки "Знайти" явно зафіксовуємо пошук
                    onFiltersChange({ ...filters, search: searchInput });
                    // Викликаємо callback для блокування автоматичного оновлення
                    onSearchClick?.();
                  }}
                >
                  Знайти
                </button>
              </div>
            </div>
            <div className="min-w-[150px]">
              <label className="label label-text text-xs">Статус</label>
              <select
                className="select select-bordered select-sm w-full"
                value={filters.statusId}
                onChange={(e) => onFiltersChange({ ...filters, statusId: e.target.value })}
              >
                <option value="">Всі статуси</option>
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[150px]">
              <label className="label label-text text-xs">Джерело</label>
              <select
                className="select select-bordered select-sm w-full"
                value={filters.source}
                onChange={(e) => onFiltersChange({ ...filters, source: e.target.value })}
              >
                <option value="">Всі джерела</option>
                <option value="instagram">Instagram</option>
                <option value="tiktok">TikTok</option>
                <option value="other">Інше</option>
              </select>
            </div>
            <div className="min-w-[150px]">
              <label className="label label-text text-xs">Відповідальний</label>
              <select
                className="select select-bordered select-sm w-full"
                value={filters.masterId}
                onChange={(e) => onFiltersChange({ ...filters, masterId: e.target.value })}
              >
                <option value="">Всі майстри</option>
                {masters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-control">
              <label className="label cursor-pointer gap-2">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={filters.hasAppointment === "true"}
                  onChange={(e) =>
                    onFiltersChange({
                      ...filters,
                      hasAppointment: e.target.checked ? "true" : "",
                    })
                  }
                />
                <span className="label-text text-xs">Запис</span>
              </label>
            </div>
            <div>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setSearchInput("");
                  onFiltersChange({ statusId: "", masterId: "", source: "", search: "", hasAppointment: "" });
                }}
              >
                Скинути
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Кнопка додати клієнта */}
      <div className="flex justify-end">
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setEditingClient({} as DirectClient)}
        >
          + Додати клієнта
        </button>
      </div>

      {/* Форма редагування */}
      {editingClient && (
        <ClientForm
          client={editingClient}
          statuses={statuses}
          masters={masters}
          onSave={async (clientData) => {
            if (editingClient.id) {
              await onClientUpdate(editingClient.id, clientData);
            } else {
              // Створення нового клієнта
              try {
                const res = await fetch(`/api/admin/direct/clients`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(clientData),
                });
                const data = await res.json();
                if (data.ok) {
                  await onRefresh();
                  setEditingClient(null);
                } else {
                  alert(data.error || "Failed to create client");
                }
              } catch (err) {
                alert(err instanceof Error ? err.message : String(err));
              }
            }
            setEditingClient(null);
          }}
          onCancel={() => setEditingClient(null)}
        />
      )}

      {/* Модальне вікно історії станів */}
      <StateHistoryModal
        client={stateHistoryClient}
        isOpen={!!stateHistoryClient}
        onClose={() => setStateHistoryClient(null)}
      />

      {/* Модальне вікно історії повідомлень */}
      <MessagesHistoryModal
        client={messagesHistoryClient}
        isOpen={!!messagesHistoryClient}
        onClose={() => setMessagesHistoryClient(null)}
      />

      {/* Модальне вікно вебхуків клієнта */}
      {webhooksClient && (
        <ClientWebhooksModal
          isOpen={!!webhooksClient}
          onClose={() => setWebhooksClient(null)}
          clientName={[webhooksClient.firstName, webhooksClient.lastName].filter(Boolean).join(' ') || webhooksClient.instagramUsername}
          altegioClientId={webhooksClient.altegioClientId}
        />
      )}

      {/* Таблиця */}
      <div className="card bg-base-100 shadow-sm">
        <div className="card-body p-2 sm:p-4">
          <div className="overflow-x-auto" style={{ maxHeight: 'calc(100vh - 60px)', overflowY: 'auto' }}>
            <table className="table table-xs sm:table-sm w-full border-collapse">
              <thead>
                <tr className="bg-base-200">
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">№</th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">
                    <button
                      className="hover:underline cursor-pointer"
                      onClick={() =>
                        onSortChange(
                          "firstContactDate",
                          sortBy === "firstContactDate" && sortOrder === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      Дата контакту {sortBy === "firstContactDate" && (sortOrder === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">
                    <button
                      className="hover:underline cursor-pointer"
                      onClick={() =>
                        onSortChange(
                          "updatedAt",
                          sortBy === "updatedAt" && sortOrder === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      Останнє оновлення {sortBy === "updatedAt" && (sortOrder === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">
                    <button
                      className="hover:underline cursor-pointer"
                      onClick={() =>
                        onSortChange(
                          "instagramUsername",
                          sortBy === "instagramUsername" && sortOrder === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      Instagram {sortBy === "instagramUsername" && (sortOrder === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">
                    Повне імʼя
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">
                    <button
                      className="hover:underline cursor-pointer"
                      onClick={() =>
                        onSortChange(
                          "spent",
                          sortBy === "spent" && sortOrder === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      Продажі {sortBy === "spent" && (sortOrder === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">
                    <button
                      className="hover:underline cursor-pointer"
                      onClick={() =>
                        onSortChange(
                          "visits",
                          sortBy === "visits" && sortOrder === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      Візити {sortBy === "visits" && (sortOrder === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">
                    <button
                      className="hover:underline cursor-pointer"
                      onClick={() =>
                        onSortChange(
                          "state",
                          sortBy === "state" && sortOrder === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      Стан {sortBy === "state" && (sortOrder === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">
                    <button
                      className="hover:underline cursor-pointer"
                      onClick={() =>
                        onSortChange(
                          "consultationBookingDate",
                          sortBy === "consultationBookingDate" && sortOrder === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      Запис на консультацію {sortBy === "consultationBookingDate" && (sortOrder === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">
                    <button
                      className="hover:underline cursor-pointer"
                      onClick={() =>
                        onSortChange(
                          "paidServiceDate",
                          sortBy === "paidServiceDate" && sortOrder === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      Запис {sortBy === "paidServiceDate" && (sortOrder === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold min-w-[180px]">
                    <button
                      className="hover:underline cursor-pointer"
                      onClick={() =>
                        onSortChange(
                          "statusId",
                          sortBy === "statusId" && sortOrder === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      Статус {sortBy === "statusId" && (sortOrder === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">
                    <button
                      className="hover:underline cursor-pointer"
                      onClick={() =>
                        onSortChange(
                          "masterId",
                          sortBy === "masterId" && sortOrder === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      Відповідальний {sortBy === "masterId" && (sortOrder === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold min-w-[200px]">
                    <button
                      className="hover:underline cursor-pointer"
                      onClick={() =>
                        onSortChange(
                          "comment",
                          sortBy === "comment" && sortOrder === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      Коментар {sortBy === "comment" && (sortOrder === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">
                    Консультував
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">
                    <button
                      className="hover:underline cursor-pointer"
                      onClick={() =>
                        onSortChange(
                          "signedUpForPaidServiceAfterConsultation",
                          sortBy === "signedUpForPaidServiceAfterConsultation" && sortOrder === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      Записалась на послугу {sortBy === "signedUpForPaidServiceAfterConsultation" && (sortOrder === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">
                    <button
                      className="hover:underline cursor-pointer"
                      onClick={() =>
                        onSortChange(
                          "visitedSalon",
                          sortBy === "visitedSalon" && sortOrder === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      Прийшов (старий) {sortBy === "visitedSalon" && (sortOrder === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">
                    <button
                      className="hover:underline cursor-pointer"
                      onClick={() =>
                        onSortChange(
                          "visitDate",
                          sortBy === "visitDate" && sortOrder === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      Дата візиту {sortBy === "visitDate" && (sortOrder === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">
                    <button
                      className="hover:underline cursor-pointer"
                      onClick={() =>
                        onSortChange(
                          "signedUpForPaidService",
                          sortBy === "signedUpForPaidService" && sortOrder === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      Записався на послугу {sortBy === "signedUpForPaidService" && (sortOrder === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">
                    <button
                      className="hover:underline cursor-pointer"
                      onClick={() =>
                        onSortChange(
                          "paidServiceDate",
                          sortBy === "paidServiceDate" && sortOrder === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      Дата запису {sortBy === "paidServiceDate" && (sortOrder === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">
                    <button
                      className="hover:underline cursor-pointer"
                      onClick={() =>
                        onSortChange(
                          "signupAdmin",
                          sortBy === "signupAdmin" && sortOrder === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      Хто записав {sortBy === "signupAdmin" && (sortOrder === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">Дії</th>
                </tr>
              </thead>
              <tbody>
                {uniqueClients.length === 0 ? (
                  <tr>
                    <td colSpan={22} className="text-center py-8 text-gray-500">
                      Немає клієнтів
                    </td>
                  </tr>
                ) : (
                  uniqueClients.map((client, index) => (
                    <tr
                      key={client.id}
                    >
                      <td className="px-1 sm:px-2 py-1 text-xs text-right">{index + 1}</td>
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap">
                        {formatDate(client.firstContactDate)}
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap">
                        {client.updatedAt
                          ? formatDate(client.updatedAt)
                          : '-'}
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap">
                        {client.instagramUsername === 'NO INSTAGRAM' ? (
                          <span className="text-orange-600 font-semibold" title="Клієнт не має Instagram акаунту">
                            NO INSTAGRAM
                          </span>
                        ) : client.instagramUsername?.startsWith('missing_instagram_') ? (
                          <span className="text-red-600 font-semibold flex items-center gap-1" title="Відсутній Instagram username">
                            {client.instagramUsername}
                            {client.telegramNotificationSent && (
                              <span className="text-blue-500" title="Повідомлення відправлено в Telegram">📱</span>
                            )}
                          </span>
                        ) : (
                        <a
                          href={`https://instagram.com/${client.instagramUsername}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="link link-primary"
                          title={client.instagramUsername}
                        >
                            {client.instagramUsername}
                        </a>
                        )}
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap max-w-[150px]">
                        <div 
                          className="truncate" 
                          title={getFullName(client)}
                        >
                          {getFullName(client)}
                        </div>
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap text-right">
                        {client.spent !== null && client.spent !== undefined
                          ? `${Math.round(client.spent / 1000).toLocaleString('uk-UA')} тис.`
                          : '-'}
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap text-center">
                        {client.visits !== null && client.visits !== undefined ? client.visits : '-'}
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap text-center min-w-[200px]">
                        <div className="flex items-center justify-center gap-1">
                          {/* Відображаємо останні 5 станів (або менше, якщо їх немає) */}
                          {(() => {
                            const states = client.last5States || [];
                            const currentState = client.state || 'lead';
                            
                            // РАДИКАЛЬНЕ ПРАВИЛО: "Лід" тільки для клієнтів з Manychat (БЕЗ altegioClientId)
                            const isManychatClient = !client.altegioClientId;
                            
                            // Якщо немає історії, показуємо поточний стан (якщо це не "lead" для Altegio клієнта)
                            if (states.length === 0) {
                              if (!isManychatClient && currentState === 'lead') {
                                return null; // Не показуємо "lead" для Altegio клієнтів
                              }
                              return (
                                <button
                                  onClick={() => setStateHistoryClient(client)}
                                  className="hover:opacity-70 transition-opacity cursor-pointer"
                                  title="Натисніть, щоб переглянути історію станів"
                                >
                                  <div className="tooltip" data-tip={new Date(client.createdAt).toLocaleDateString('uk-UA')}>
                                    <StateIcon state={currentState} size={32} />
                                  </div>
                                </button>
                              );
                            }
                            
                            // Спочатку сортуємо від старіших до новіших для правильної фільтрації
                            const sortedStates = [...states].sort((a, b) => 
                              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                            );
                            
                            // ФІЛЬТРУЄМО: для Altegio клієнтів - видаляємо ВСІ "lead"
                            // для Manychat клієнтів - залишаємо тільки найстаріший "lead", але тільки якщо він дійсно найстаріший
                            // для ВСІХ клієнтів - залишаємо тільки найстаріший "client" (стан "client" має бути тільки один раз)
                            // ВИДАЛЯЄМО ВСІ "no-instagram" (це були червоні квадрати, які потім стали чорними лійками)
                            // НОВЕ ПРАВИЛО: Якщо найстаріший стан - "message", відображаємо його як "Лід"
                            const filteredStates: typeof sortedStates = [];
                            const leadLogs: typeof sortedStates = [];
                            const messageLogs: typeof sortedStates = [];
                            const clientLogs: typeof sortedStates = [];
                            const consultationLogs: typeof sortedStates = [];
                            const consultationBookedLogs: typeof sortedStates = [];
                            const consultationNoShowLogs: typeof sortedStates = [];
                            const consultationRescheduledLogs: typeof sortedStates = [];
                            const otherLogs: typeof sortedStates = [];
                            
                            for (let i = 0; i < sortedStates.length; i++) {
                              const log = sortedStates[i];
                              
                              // ВИДАЛЯЄМО "no-instagram" (це були червоні квадрати)
                              if (log.state === 'no-instagram') {
                                continue; // Пропускаємо всі "no-instagram"
                              }
                              
                              if (log.state === 'lead') {
                                // Для Altegio клієнтів - ПРИХОВУЄМО ВСІ "lead"
                                if (!isManychatClient) {
                                  continue; // Пропускаємо всі "lead" для Altegio клієнтів
                                }
                                // Для Manychat клієнтів - збираємо "lead" окремо
                                leadLogs.push(log);
                              } else if (log.state === 'message') {
                                // Збираємо "message" окремо для перевірки, чи це перше повідомлення
                                messageLogs.push(log);
                              } else if (log.state === 'client') {
                                // Збираємо "client" окремо для фільтрації дублікатів
                                clientLogs.push(log);
                              } else if (log.state === 'consultation') {
                                consultationLogs.push(log);
                              } else if (log.state === 'consultation-booked') {
                                consultationBookedLogs.push(log);
                              } else if (log.state === 'consultation-no-show') {
                                consultationNoShowLogs.push(log);
                              } else if (log.state === 'consultation-rescheduled') {
                                consultationRescheduledLogs.push(log);
                              } else {
                                // Всі інші стани збираємо окремо
                                otherLogs.push(log);
                              }
                            }
                            
                            // НОВЕ ПРАВИЛО: Якщо найстаріший стан - "message", відображаємо його як "Лід"
                            // Це працює для ВСІХ клієнтів (навіть з altegioClientId), бо перше повідомлення = перший контакт = Лід
                            // АЛЕ: якщо є справжній "lead" стан, він має пріоритет
                            let oldestMessageAsLead: typeof sortedStates[0] | null = null;
                            if (messageLogs.length > 0 && leadLogs.length === 0) {
                              // Перевіряємо, чи "message" найстаріший стан тільки якщо немає справжнього "lead"
                              const oldestMessage = messageLogs[0]; // Вже відсортовано від старіших до новіших
                              
                              // Перевіряємо, чи "message" найстаріший стан (перевіряємо проти всіх інших станів)
                              const allOtherStates = [...clientLogs, ...consultationLogs, ...consultationBookedLogs, ...consultationNoShowLogs, ...consultationRescheduledLogs, ...otherLogs];
                              const olderThanMessage = allOtherStates.filter(log => 
                                new Date(log.createdAt).getTime() < new Date(oldestMessage.createdAt).getTime()
                              );
                              
                              // Якщо "message" найстаріший - відображаємо його як "Лід"
                              if (olderThanMessage.length === 0) {
                                oldestMessageAsLead = {
                                  ...oldestMessage,
                                  state: 'lead', // Відображаємо як "Лід"
                                };
                              }
                            }
                            
                            // Якщо перше повідомлення має відображатися як "Лід" - додаємо його
                            if (oldestMessageAsLead) {
                              filteredStates.push(oldestMessageAsLead);
                            } else if (isManychatClient && leadLogs.length > 0) {
                              // Для Manychat клієнтів: залишаємо тільки найстаріший "lead", але тільки якщо він дійсно найстаріший
                              const oldestLead = leadLogs[0]; // Найстаріший "lead" (вже відсортовано)
                              
                              // Перевіряємо, чи є стани старіші за "lead" (враховуючи всі стани, включно з message)
                              const allOtherStates = [...clientLogs, ...messageLogs, ...consultationLogs, ...consultationBookedLogs, ...consultationNoShowLogs, ...consultationRescheduledLogs, ...otherLogs];
                              const olderThanLead = allOtherStates.filter(log => 
                                new Date(log.createdAt).getTime() < new Date(oldestLead.createdAt).getTime()
                              );
                              
                              // Якщо "lead" найстаріший - залишаємо його (він початковий стан)
                              // Якщо є стани старіші - не показуємо "lead" (він не є початковим станом)
                              if (olderThanLead.length === 0) {
                                // "lead" найстаріший - додаємо його першим
                                filteredStates.push(oldestLead);
                              }
                              // Якщо є стани старіші - не додаємо "lead"
                            }
                            
                            // Для ВСІХ клієнтів: залишаємо тільки найстаріший "client"
                            if (clientLogs.length > 0) {
                              filteredStates.push(clientLogs[0]); // Тільки найстаріший "client"
                            }
                            
                            // Для consultation-related станів - залишаємо тільки найстаріший (якщо є)
                            if (consultationLogs.length > 0) {
                              filteredStates.push(consultationLogs[0]); // Тільки найстаріший "consultation"
                            }
                            if (consultationBookedLogs.length > 0) {
                              filteredStates.push(consultationBookedLogs[0]); // Тільки найстаріший "consultation-booked"
                            }
                            if (consultationNoShowLogs.length > 0) {
                              filteredStates.push(consultationNoShowLogs[0]); // Тільки найстаріший "consultation-no-show"
                            }
                            if (consultationRescheduledLogs.length > 0) {
                              filteredStates.push(consultationRescheduledLogs[0]); // Тільки найстаріший "consultation-rescheduled"
                            }
                            
                            // Додаємо всі інші стани (без "no-instagram")
                            // Якщо перше повідомлення вже відображено як "Лід", не додаємо інші "message" стани
                            const remainingMessageLogs = oldestMessageAsLead 
                              ? messageLogs.filter(log => log.id !== oldestMessageAsLead.id)
                              : messageLogs;
                            filteredStates.push(...remainingMessageLogs);
                            
                            // Додаємо всі інші стани
                            filteredStates.push(...otherLogs);
                            
                            // Сортуємо від старіших до новіших для подальшої обробки
                            filteredStates.sort((a, b) => 
                              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                            );
                            
                            // Останній стан з історії
                            const lastHistoryState = filteredStates[filteredStates.length - 1]?.state || null;
                            
                            // Додаємо поточний стан, якщо він відрізняється
                            const statesToShow = [...filteredStates];
                            
                            // Перевіряємо, чи є "lead" та "client" в відфільтрованих станах
                            const hasLeadInFiltered = filteredStates.some(log => log.state === 'lead');
                            const hasClientInFiltered = filteredStates.some(log => log.state === 'client');
                            
                            if (currentState !== lastHistoryState) {
                              // Для Altegio клієнтів - НЕ додаємо поточний стан, якщо він "lead"
                              if (!isManychatClient && currentState === 'lead') {
                                // Не додаємо "lead" для Altegio клієнтів
                              } else if (currentState === 'lead' && !hasLeadInFiltered) {
                                // Для Manychat клієнтів - додаємо "lead" тільки якщо його немає в історії
                                statesToShow.push({
                                  id: 'current',
                                  clientId: client.id,
                                  state: currentState,
                                  previousState: lastHistoryState,
                                  reason: 'current-state',
                                  createdAt: new Date().toISOString(),
                                });
                              } else if (currentState === 'client' && !hasClientInFiltered) {
                                // Для "client" - додаємо тільки якщо його немає в історії (стан "client" має бути тільки один раз)
                                statesToShow.push({
                                  id: 'current',
                                  clientId: client.id,
                                  state: currentState,
                                  previousState: lastHistoryState,
                                  reason: 'current-state',
                                  createdAt: new Date().toISOString(),
                                });
                              } else if (currentState !== 'lead' && currentState !== 'client') {
                                // Для всіх інших станів - завжди додаємо
                              statesToShow.push({
                                id: 'current',
                                clientId: client.id,
                                state: currentState,
                                previousState: lastHistoryState,
                                reason: 'current-state',
                                createdAt: new Date().toISOString(),
                              });
                            }
                            }
                            
                            // Фінальна перевірка: видаляємо всі "lead" для Altegio клієнтів та "no-instagram" для всіх
                            // Також приховуємо невідомі стани, які можуть показуватись як чорні лійки (image-lead.png)
                            const finalStatesToShow = statesToShow.filter(log => {
                              // Видаляємо "no-instagram"
                              if (log.state === 'no-instagram') return false;
                              
                              // Видаляємо "lead" для Altegio клієнтів
                              if (!isManychatClient && log.state === 'lead') return false;
                              
                              // Приховуємо null/undefined стани (вони показуються як "lead")
                              if (!log.state || log.state.trim() === '') return false;
                              
                              return true;
                            });
                            
                            return (
                              <>
                                {finalStatesToShow.slice(-5).map((stateLog, idx) => {
                                  const stateDate = new Date(stateLog.createdAt);
                                  const formattedDate = stateDate.toLocaleDateString('uk-UA', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    year: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  });
                                  
                                  // Гарантуємо, що state не є "no-instagram" або "lead" для Altegio клієнтів
                                  const stateToShow = (!isManychatClient && stateLog.state === 'lead') || stateLog.state === 'no-instagram'
                                    ? null
                                    : (stateLog.state || null);
                                  
                                  // Якщо state null після фільтрації, не показуємо іконку
                                  if (!stateToShow) return null;
                                  
                                  // Визначаємо, який обробник кліку використовувати
                                  const isMessageState = stateToShow === 'message';
                                  const onClickHandler = isMessageState
                                    ? () => setMessagesHistoryClient(client)
                                    : () => setStateHistoryClient(client);
                                  const tooltipText = isMessageState
                                    ? `${formattedDate}\nНатисніть, щоб переглянути історію повідомлень`
                                    : `${formattedDate}\nНатисніть, щоб переглянути історію станів`;
                                  
                                  return (
                                    <button
                                      key={stateLog.id || `state-${idx}`}
                                      onClick={onClickHandler}
                                      className="hover:opacity-70 transition-opacity cursor-pointer"
                                      title={tooltipText}
                                    >
                                      <div className="tooltip tooltip-top" data-tip={formattedDate}>
                                        <StateIcon state={stateToShow} size={28} />
                                      </div>
                                    </button>
                                  );
                                })}
                              </>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap">
                        {client.consultationBookingDate ? (
                          (() => {
                            try {
                              // Перевіряємо, чи це не масив або кілька дат
                              const dateValue = typeof client.consultationBookingDate === 'string' 
                                ? client.consultationBookingDate.trim() 
                                : client.consultationBookingDate;
                              
                              // Витягуємо тільки дату (ISO формат: YYYY-MM-DDTHH:mm:ss.sssZ або подібний)
                              // Відкидаємо все, що не схоже на дату
                              let dateStr = typeof dateValue === 'string' ? dateValue : String(dateValue);
                              
                              // Шукаємо ISO дату в рядку (YYYY-MM-DD або YYYY-MM-DDTHH:mm:ss)
                              const isoDateMatch = dateStr.match(/\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[\+\-]\d{2}:\d{2})?)?/);
                              if (!isoDateMatch) {
                                // Якщо не знайшли ISO формат, спробуємо інші формати
                                const parts = dateStr.split(/\s+/);
                                for (const part of parts) {
                                  const testDate = new Date(part);
                                  if (!isNaN(testDate.getTime()) && part.match(/^\d/)) {
                                    dateStr = part;
                                    break;
                                  }
                                }
                              } else {
                                dateStr = isoDateMatch[0];
                              }
                              
                              const appointmentDate = new Date(dateStr);
                              if (isNaN(appointmentDate.getTime())) {
                                console.warn('[DirectClientTable] Invalid consultationBookingDate:', client.consultationBookingDate);
                                return "";
                              }
                              
                              const now = new Date();
                              now.setHours(0, 0, 0, 0);
                              appointmentDate.setHours(0, 0, 0, 0);
                              const isPast = appointmentDate < now;
                              const isPastOrToday = appointmentDate <= now;
                              const formattedDateStr = formatDate(dateStr);
                              const isOnline = client.isOnlineConsultation || false;
                              
                              // Форматуємо дату створення запису для tooltip
                              const createdAtDate = client.updatedAt ? new Date(client.updatedAt) : null;
                              const createdAtStr = createdAtDate && !isNaN(createdAtDate.getTime())
                                ? createdAtDate.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
                                : null;
                              
                              // Діагностика для "Юлія Кобра" та "Топоріна Олена"
                              const isDebugClient = client.instagramUsername === 'kobra_best' || 
                                                   client.instagramUsername === 'olena_toporina' ||
                                                   (client.firstName === 'Юлія' && client.lastName === 'Кобра') ||
                                                   (client.firstName === 'Топоріна' && client.lastName === 'Олена');
                              
                              if (isDebugClient) {
                                console.log(`[DirectClientTable] 🔍 Діагностика для ${client.instagramUsername || 'unknown'}:`, {
                                  clientId: client.id,
                                  instagramUsername: client.instagramUsername,
                                  firstName: client.firstName,
                                  lastName: client.lastName,
                                  consultationBookingDate: client.consultationBookingDate,
                                  consultationBookingDateType: typeof client.consultationBookingDate,
                                  isOnlineConsultation: client.isOnlineConsultation,
                                  isOnlineConsultationType: typeof client.isOnlineConsultation,
                                  isOnline: isOnline,
                                  dateStr: formattedDateStr,
                                  extractedDateStr: dateStr,
                                  dateValue,
                                  paidServiceDate: client.paidServiceDate,
                                  signedUpForPaidService: client.signedUpForPaidService,
                                  fullClient: client,
                                });
                              }
                              
                              // Визначаємо значок attendance
                              let attendanceIcon = null;
                              if (isPastOrToday) {
                                if (client.consultationAttended === true) {
                                  attendanceIcon = <span className="text-green-600 text-lg" title="Клієнтка прийшла на консультацію">✅</span>;
                                } else if (client.consultationAttended === false) {
                                  attendanceIcon = <span className="text-red-600 text-lg" title="Клієнтка не з'явилася на консультацію">❌</span>;
                                } else {
                                  attendanceIcon = <span className="text-gray-500 text-lg" title="Немає підтвердження відвідування консультації (встановіть attendance в Altegio)">❓</span>;
                                }
                              }
                              
                              const baseTitle = isPast 
                                ? (isOnline ? "Минулий запис на онлайн-консультацію" : "Минулий запис на консультацію")
                                : (isOnline ? "Майбутній запис на онлайн-консультацію" : "Майбутній запис на консультацію");
                              const tooltipTitle = createdAtStr ? `${baseTitle}\nЗапис створено: ${createdAtStr}` : baseTitle;
                              
                              return (
                                <span className="flex items-center gap-1">
                                  <span
                                    className={isPast ? "text-amber-600 font-medium" : "text-blue-600 font-medium"}
                                    title={tooltipTitle}
                                  >
                                    {formattedDateStr} {isOnline ? "💻" : "📅"}
                                  </span>
                                  {attendanceIcon}
                                </span>
                              );
                            } catch (err) {
                              console.error('[DirectClientTable] Error formatting consultationBookingDate:', err, client.consultationBookingDate);
                              return "";
                            }
                          })()
                        ) : (
                          ""
                        )}
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap">
                        {client.signedUpForPaidService && client.paidServiceDate ? (
                          (() => {
                            const appointmentDate = new Date(client.paidServiceDate);
                            const now = new Date();
                            now.setHours(0, 0, 0, 0); // Порівнюємо тільки дати, без часу
                            appointmentDate.setHours(0, 0, 0, 0);
                            const isPast = appointmentDate < now;
                            const isPastOrToday = appointmentDate <= now;
                            const dateStr = formatDate(client.paidServiceDate);
                            
                            // Форматуємо дату створення запису для tooltip
                            const createdAtDate = client.updatedAt ? new Date(client.updatedAt) : null;
                            const createdAtStr = createdAtDate && !isNaN(createdAtDate.getTime())
                              ? createdAtDate.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
                              : null;
                            
                            // Визначаємо значок attendance
                            let attendanceIcon = null;
                            if (isPastOrToday) {
                              if (client.paidServiceAttended === true) {
                                attendanceIcon = <span className="text-green-600 text-lg" title="Клієнтка прийшла на платну послугу">✅</span>;
                              } else if (client.paidServiceAttended === false) {
                                attendanceIcon = <span className="text-red-600 text-lg" title="Клієнтка не з'явилася на платну послугу">❌</span>;
                              } else {
                                attendanceIcon = <span className="text-gray-500 text-lg" title="Немає підтвердження відвідування платної послуги (встановіть attendance в Altegio)">❓</span>;
                              }
                            }
                            
                            const baseTitle = isPast ? "Минулий запис на платну послугу" : "Майбутній запис на платну послугу";
                            const tooltipTitle = createdAtStr ? `${baseTitle}\nЗапис створено: ${createdAtStr}` : baseTitle;
                            
                            return (
                              <span className="flex items-center gap-1">
                                <span
                                  className={isPast ? "text-amber-600 font-medium" : "text-blue-600 font-medium"}
                                  title={tooltipTitle}
                                >
                                  {dateStr}
                                </span>
                                {attendanceIcon}
                              </span>
                            );
                          })()
                        ) : (
                          ""
                        )}
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs min-w-[180px]">
                        <select
                          className="select select-xs select-bordered w-full min-w-[160px]"
                          value={client.statusId}
                          onChange={(e) => handleStatusChange(client, e.target.value)}
                          style={{ 
                            borderColor: getStatusColor(client.statusId),
                            backgroundColor: getStatusColor(client.statusId) + "20"
                          }}
                        >
                          {statuses.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs">
                        <select
                          className="select select-xs select-bordered w-full max-w-[120px]"
                          value={client.masterId || ""}
                          onChange={(e) => handleMasterChange(client, e.target.value || undefined)}
                        >
                          <option value="">-</option>
                          {masters.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs min-w-[200px]">
                        <input
                          type="text"
                          className="input input-xs input-bordered w-full min-w-[180px]"
                          placeholder="Коментар..."
                          value={client.comment || ""}
                          onChange={(e) => handleFieldUpdate(client, "comment", e.target.value || undefined)}
                          title={client.comment || "Коментар..."}
                        />
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap">
                        {client.consultationMasterName || "-"}
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs">
                          <input
                          type="checkbox"
                          className="checkbox checkbox-xs"
                          checked={client.signedUpForPaidServiceAfterConsultation || false}
                          disabled
                          title={client.signedUpForPaidServiceAfterConsultation ? "Записалась на платну послугу після консультації" : "Не записалась на платну послугу після консультації"}
                          />
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-xs"
                          checked={client.visitedSalon}
                          onChange={(e) => {
                            const updates: Partial<DirectClient> = {
                              visitedSalon: e.target.checked,
                              visitDate: e.target.checked ? new Date().toISOString() : undefined,
                            };
                            // Оновлюємо обидва поля одночасно
                            onClientUpdate(client.id, updates);
                          }}
                        />
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap">
                        {client.visitedSalon && client.visitDate ? formatDate(client.visitDate) : "-"}
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-xs"
                          checked={client.signedUpForPaidService}
                          onChange={(e) => {
                            const updates: Partial<DirectClient> = {
                              signedUpForPaidService: e.target.checked,
                              paidServiceDate: e.target.checked ? new Date().toISOString() : undefined,
                            };
                            // Оновлюємо обидва поля одночасно
                            onClientUpdate(client.id, updates);
                          }}
                        />
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap">
                        {client.signedUpForPaidService && client.paidServiceDate ? formatDate(client.paidServiceDate) : "-"}
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs">
                        <input
                          type="text"
                          className="input input-xs input-bordered w-full max-w-[100px]"
                          placeholder="Адмін"
                          value={client.signupAdmin || ""}
                          onChange={(e) => handleFieldUpdate(client, "signupAdmin", e.target.value || undefined)}
                        />
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs">
                        <div className="flex gap-1">
                          <button
                            className="btn btn-xs btn-ghost"
                            onClick={() => setEditingClient(client)}
                            title="Редагувати"
                          >
                            ✏️
                          </button>
                          {client.altegioClientId && (
                            <button
                              className="btn btn-xs btn-ghost text-info"
                              onClick={() => setWebhooksClient(client)}
                              title="Переглянути вебхуки клієнта"
                            >
                              🔗
                            </button>
                          )}
                          <button
                            className="btn btn-xs btn-ghost text-info"
                            onClick={async () => {
                              try {
                                const fullName = [client.firstName, client.lastName].filter(Boolean).join(' ');
                                const res = await fetch('/api/admin/direct/diagnose-client', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    instagramUsername: client.instagramUsername,
                                    fullName: fullName || undefined,
                                    altegioClientId: client.altegioClientId || undefined,
                                  }),
                                });
                                const data = await res.json();
                                if (data.ok) {
                                  const diagnosis = data.diagnosis;
                                  let message = `🔍 Діагностика клієнтки: ${fullName || client.instagramUsername}\n\n`;
                                  
                                  if (diagnosis.directClient) {
                                    message += `✅ Клієнтка знайдена в Direct Manager\n`;
                                    message += `   ID: ${diagnosis.directClient.id}\n`;
                                    message += `   Instagram: ${diagnosis.directClient.instagramUsername}\n`;
                                    message += `   Стан: ${diagnosis.directClient.state || 'не встановлено'}\n`;
                                    message += `   Altegio ID: ${diagnosis.directClient.altegioClientId || 'немає'}\n\n`;
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
                                    message += `  З "Нарощування волосся": ${diagnosis.records.withHairExtension}\n\n`;
                                  }
                                  
                                  if (diagnosis.webhooks) {
                                    message += `Вебхуки:\n`;
                                    message += `  Всього: ${diagnosis.webhooks.total}\n`;
                                    message += `  Записи: ${diagnosis.webhooks.records}\n`;
                                    message += `  Клієнти: ${diagnosis.webhooks.clients}\n\n`;
                                  }
                                  
                                  message += `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                                  
                                  // Використовуємо alert з можливістю копіювання
                                  alert(message);
                                  // Також виводимо в консоль для детального аналізу
                                  console.log('Client Diagnosis:', data);
                                } else {
                                  alert(`Помилка діагностики: ${data.error || 'Невідома помилка'}`);
                                }
                              } catch (err) {
                                alert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
                              }
                            }}
                            title="Діагностика"
                          >
                            🔍
                          </button>
                          <button
                            className="btn btn-xs btn-ghost text-error"
                            onClick={async () => {
                              if (!confirm(`Видалити клієнта @${client.instagramUsername}?\n\nЦю дію неможливо скасувати.`)) {
                                return;
                              }
                              try {
                                const res = await fetch(`/api/admin/direct/clients/${client.id}`, {
                                  method: 'DELETE',
                                });
                                const data = await res.json();
                                if (data.ok) {
                                  await onRefresh();
                                } else {
                                  alert(`Помилка видалення: ${data.error || 'Невідома помилка'}`);
                                }
                              } catch (err) {
                                alert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
                              }
                            }}
                            title="Видалити"
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
