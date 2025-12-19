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
                          "masterId",
                          sortBy === "masterId" && sortOrder === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      Майстер {sortBy === "masterId" && (sortOrder === "asc" ? "↑" : "↓")}
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
                {clients.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="text-center py-8 text-gray-500">
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
                        <a
                          href={`https://instagram.com/${client.instagramUsername}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="link link-primary"
                        >
                          @{client.instagramUsername}
                        </a>
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs min-w-[180px]">
                        <select
                          className="select select-xs select-bordered w-full min-w-[160px]"
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
                            // Оновлюємо обидва поля одночасно
                            onClientUpdate(client.id, updates);
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
                            // Оновлюємо обидва поля одночасно
                            onClientUpdate(client.id, updates);
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
