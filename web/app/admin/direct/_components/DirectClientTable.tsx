// web/app/admin/direct/_components/DirectClientTable.tsx
// Таблиця клієнтів Direct

"use client";

import { useState, useEffect, useMemo } from "react";
import type { DirectClient, DirectStatus } from "@/lib/direct-types";
import { ClientForm } from "./ClientForm";
import { StateHistoryModal } from "./StateHistoryModal";

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
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={iconStyle}>
        <path d="M7 14 C7 10.686 9.686 8 13 8 C16.314 8 19 10.686 19 14 C19 17.314 16.314 20 13 20 L7 20 C4.791 20 3 18.209 3 16 C3 13.791 4.791 12 7 12" stroke="#10b981" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <circle cx="10" cy="14" r="1" fill="#10b981"/>
        <circle cx="13" cy="14" r="1" fill="#10b981"/>
        <circle cx="16" cy="14" r="1" fill="#10b981"/>
        <path d="M7 20 L5 22 L7 22 Z" fill="#10b981"/>
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
  } else if (state === 'no-instagram') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={iconStyle}>
        <rect x="4" y="4" width="20" height="20" rx="2" fill="#ef4444" stroke="#dc2626" strokeWidth="1.5"/>
        <path d="M10 10 L18 18 M18 10 L10 18" stroke="white" strokeWidth="2" strokeLinecap="round"/>
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
  };
  onFiltersChange: (filters: DirectClientTableProps["filters"]) => void;
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
  sortBy,
  sortOrder,
  onSortChange,
  onClientUpdate,
  onRefresh,
}: DirectClientTableProps) {
  const [editingClient, setEditingClient] = useState<DirectClient | null>(null);
  const [masters, setMasters] = useState<Array<{ id: string; name: string }>>([]);
  const [stateHistoryClient, setStateHistoryClient] = useState<DirectClient | null>(null);
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
    const parts = [client.firstName, client.lastName].filter(Boolean);
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
            <div className="flex-1 min-w-[200px]">
              <label className="label label-text text-xs">Пошук по Instagram або Повне ім'я</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Введіть username або ім'я..."
                  className="input input-bordered input-sm flex-1"
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
                    }
                  }}
                />
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => {
                    // При натисканні кнопки "Знайти" явно зафіксовуємо пошук
                    onFiltersChange({ ...filters, search: searchInput });
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
            <div>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setSearchInput("");
                  onFiltersChange({ statusId: "", masterId: "", source: "", search: "" });
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

      {/* Таблиця */}
      <div className="card bg-base-100 shadow-sm">
        <div className="card-body p-2 sm:p-4">
          <div className="overflow-x-auto">
            <table className="table table-xs sm:table-sm w-full border-collapse">
              <thead>
                <tr className="bg-base-200">
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold">№</th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold">
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
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold">
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
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold">
                    Повне імʼя
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold">
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
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold">
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
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold">
                    <button
                      className="hover:underline cursor-pointer"
                      onClick={() =>
                        onSortChange(
                          "consultationDate",
                          sortBy === "consultationDate" && sortOrder === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      Дата консультації {sortBy === "consultationDate" && (sortOrder === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold">
                    <button
                      className="hover:underline cursor-pointer"
                      onClick={() =>
                        onSortChange(
                          "visitedSalon",
                          sortBy === "visitedSalon" && sortOrder === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      Прийшов {sortBy === "visitedSalon" && (sortOrder === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold">
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
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold">
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
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold">
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
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold">
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
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold">Дії</th>
                </tr>
              </thead>
              <tbody>
                {uniqueClients.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="text-center py-8 text-gray-500">
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
                        <a
                          href={`https://instagram.com/${client.instagramUsername}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="link link-primary"
                          title={client.instagramUsername}
                        >
                          {client.instagramUsername}
                        </a>
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap max-w-[150px]">
                        <div 
                          className="truncate" 
                          title={getFullName(client)}
                        >
                          {getFullName(client)}
                        </div>
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap text-center min-w-[200px]">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setStateHistoryClient(client)}
                            className="hover:opacity-70 transition-opacity cursor-pointer flex items-center justify-center gap-1"
                            title="Натисніть, щоб переглянути повну історію змін стану"
                          >
                            {/* Відображаємо останні 5 станів (або менше, якщо їх немає) */}
                            {(() => {
                              const states = client.last5States || [];
                              const currentState = client.state || 'lead';
                              
                              // Якщо немає історії, показуємо поточний стан
                              if (states.length === 0) {
                                return (
                                  <div className="tooltip" data-tip={new Date(client.createdAt).toLocaleDateString('uk-UA')}>
                                    <StateIcon state={currentState} size={32} />
                                  </div>
                                );
                              }
                              
                              // Показуємо останні 5 станів (або менше)
                              // Актуальний стан справа (останній в масиві)
                              // Сортуємо від старіших до новіших для відображення (актуальний справа)
                              const sortedStates = [...states].sort((a, b) => 
                                new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                              );
                              
                              // Останній стан з історії
                              const lastHistoryState = sortedStates[sortedStates.length - 1]?.state || null;
                              
                              // Якщо поточний стан відрізняється від останнього в історії, додаємо його
                              const statesToShow = [...sortedStates];
                              if (currentState !== lastHistoryState) {
                                statesToShow.push({
                                  id: 'current',
                                  clientId: client.id,
                                  state: currentState,
                                  previousState: lastHistoryState,
                                  reason: 'current-state',
                                  createdAt: new Date().toISOString(),
                                });
                              }
                              
                              return (
                                <>
                                  {statesToShow.slice(-5).map((stateLog, idx) => {
                                    const stateDate = new Date(stateLog.createdAt);
                                    const formattedDate = stateDate.toLocaleDateString('uk-UA', {
                                      day: '2-digit',
                                      month: '2-digit',
                                      year: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    });
                                    
                                    return (
                                      <div
                                        key={stateLog.id || `state-${idx}`}
                                        className="tooltip tooltip-top"
                                        data-tip={formattedDate}
                                      >
                                        <StateIcon state={stateLog.state || 'lead'} size={28} />
                                      </div>
                                    );
                                  })}
                                </>
                              );
                            })()}
                          </button>
                          {/* Червоний квадрат для клієнтів без Instagram (показуємо тільки один раз) */}
                          {(() => {
                            const hasNoInstagramState = client.state === 'no-instagram';
                            const hasMissingInstagramUsername = client.instagramUsername?.startsWith('missing_instagram_');
                            
                            // Показуємо червоний квадрат тільки якщо є стан no-instagram АБО missing_instagram_ username
                            // Але не показуємо, якщо вже є піктограма стану no-instagram в історії (щоб не дублювати)
                            if (hasNoInstagramState || hasMissingInstagramUsername) {
                              const states = client.last5States || [];
                              // Перевіряємо, чи вже є піктограма стану no-instagram в історії
                              const hasNoInstagramIconInHistory = states.some(s => s.state === 'no-instagram');
                              
                              // Показуємо червоний квадрат тільки якщо немає піктограми стану no-instagram в історії
                              // Або якщо немає історії взагалі, але є стан no-instagram
                              if (!hasNoInstagramIconInHistory) {
                                return (
                                  <div 
                                    className="tooltip tooltip-top" 
                                    data-tip="Відсутній Instagram username. Будь ласка, додайте його в Altegio або відправте у відповідь на повідомлення."
                                  >
                                    <div 
                                      className="w-4 h-4 bg-red-500 rounded-sm border border-red-700"
                                      style={{ minWidth: '16px', minHeight: '16px' }}
                                    />
                                  </div>
                                );
                              }
                            }
                            return null;
                          })()}
                        </div>
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
                        {client.consultationDate ? (
                          <input
                            type="date"
                            className="input input-xs input-bordered w-full max-w-[120px]"
                            value={client.consultationDate.split("T")[0]}
                            onChange={(e) =>
                              handleFieldUpdate(client, "consultationDate", e.target.value ? `${e.target.value}T00:00:00.000Z` : undefined)
                            }
                          />
                        ) : (
                          <input
                            type="date"
                            className="input input-xs input-bordered w-full max-w-[120px]"
                            onChange={(e) =>
                              handleFieldUpdate(client, "consultationDate", e.target.value ? `${e.target.value}T00:00:00.000Z` : undefined)
                            }
                          />
                        )}
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
