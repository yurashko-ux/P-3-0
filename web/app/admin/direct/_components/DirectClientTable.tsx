// web/app/admin/direct/_components/DirectClientTable.tsx
// Таблиця клієнтів Direct

"use client";

import { useState, useEffect } from "react";
import type { DirectClient, DirectStatus } from "@/lib/direct-types";
import { ClientForm } from "./ClientForm";

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
  sortBy: "firstContactDate" | "lastMessageAt" | "statusId";
  sortOrder: "asc" | "desc";
  onSortChange: (by: DirectClientTableProps["sortBy"], order: DirectClientTableProps["sortOrder"]) => void;
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

  // Завантажуємо майстрів
  useEffect(() => {
    fetch("/api/photo-reports/masters")
      .then((res) => {
        if (!res.ok) {
          console.warn(`[DirectClientTable] Failed to load masters: ${res.status} ${res.statusText}`);
          return null;
        }
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

  const handleStatusChange = async (client: DirectClient, newStatusId: string) => {
    await onClientUpdate(client.id, { statusId: newStatusId });
  };

  const handleMasterChange = async (client: DirectClient, masterId: string | undefined) => {
    await onClientUpdate(client.id, { masterId });
  };

  const handleFieldUpdate = async (client: DirectClient, field: keyof DirectClient, value: any) => {
    await onClientUpdate(client.id, { [field]: value });
  };

  return (
    <div className="space-y-4">
      {/* Фільтри та пошук */}
      <div className="card bg-base-100 shadow-sm">
        <div className="card-body p-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="label label-text text-xs">Пошук по Instagram</label>
              <input
                type="text"
                placeholder="Введіть username..."
                className="input input-bordered input-sm w-full"
                value={filters.search}
                onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
              />
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
              <label className="label label-text text-xs">Майстер</label>
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

      {/* Таблиця */}
      <div className="card bg-base-100 shadow-sm">
        <div className="card-body p-2 sm:p-4">
          <div className="overflow-x-auto">
            <table className="table table-xs sm:table-sm w-full border-collapse min-w-[800px]">
              <thead>
                <tr className="bg-base-200">
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold">
                    <button
                      className="hover:underline"
                      onClick={() =>
                        onSortChange(
                          "firstContactDate",
                          sortBy === "firstContactDate" && sortOrder === "asc" ? "desc" : "asc"
                        )
                      }
                    >
                      Дата контакту {sortBy === "firstContactDate" && (sortOrder === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold">Джерело</th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold">Instagram</th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold">Статус</th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold">Майстер</th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold">Дата консультації</th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold">Прийшов</th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold">Дата візиту</th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold">Записався на послугу</th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold">Дата запису</th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold">Хто записав</th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold">Коментар</th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold">Дії</th>
                </tr>
              </thead>
              <tbody>
                {clients.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="text-center py-8 text-gray-500">
                      Немає клієнтів
                    </td>
                  </tr>
                ) : (
                  clients.map((client) => (
                    <tr
                      key={client.id}
                      style={{
                        backgroundColor: getStatusColor(client.statusId) + "20",
                        borderLeft: `3px solid ${getStatusColor(client.statusId)}`,
                      }}
                    >
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap">
                        {formatDate(client.firstContactDate)}
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap">
                        {client.source === "instagram" ? "📷 Instagram" : client.source === "tiktok" ? "🎵 TikTok" : "📱 Інше"}
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap">
                        <a
                          href={`https://instagram.com/${client.instagramUsername}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="link link-primary"
                        >
                          @{client.instagramUsername}
                        </a>
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs">
                        <select
                          className="select select-xs select-bordered w-full max-w-[120px]"
                          value={client.statusId}
                          onChange={(e) => handleStatusChange(client, e.target.value)}
                          style={{ borderColor: getStatusColor(client.statusId) }}
                        >
                          {statuses.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs">
                        {client.statusId === "consultation" ? (
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
                        ) : (
                          "-"
                        )}
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
                            handleFieldUpdate(client, "visitedSalon", updates.visitedSalon);
                            if (updates.visitDate) {
                              handleFieldUpdate(client, "visitDate", updates.visitDate);
                            }
                          }}
                        />
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap">
                        {client.visitDate ? formatDate(client.visitDate) : "-"}
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
                            handleFieldUpdate(client, "signedUpForPaidService", updates.signedUpForPaidService);
                            if (updates.paidServiceDate) {
                              handleFieldUpdate(client, "paidServiceDate", updates.paidServiceDate);
                            }
                          }}
                        />
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap">
                        {client.paidServiceDate ? formatDate(client.paidServiceDate) : "-"}
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
                        <input
                          type="text"
                          className="input input-xs input-bordered w-full max-w-[150px]"
                          placeholder="Коментар..."
                          value={client.comment || ""}
                          onChange={(e) => handleFieldUpdate(client, "comment", e.target.value || undefined)}
                        />
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs">
                        <button
                          className="btn btn-xs btn-ghost"
                          onClick={() => setEditingClient(client)}
                          title="Редагувати"
                        >
                          ✏️
                        </button>
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
