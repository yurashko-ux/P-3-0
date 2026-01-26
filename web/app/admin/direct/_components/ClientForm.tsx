// web/app/admin/direct/_components/ClientForm.tsx
// Форма для створення/редагування клієнта

"use client";

import { useState, useEffect } from "react";
import type { DirectClient, DirectStatus } from "@/lib/direct-types";

type ClientFormProps = {
  client: Partial<DirectClient>;
  statuses: DirectStatus[];
  masters: Array<{ id: string; name: string; role?: string }>;
  onSave: (clientData: Partial<DirectClient>) => Promise<void>;
  onCancel: () => void;
};

export function ClientForm({ client, statuses, masters, onSave, onCancel }: ClientFormProps) {
  const [formData, setFormData] = useState<Partial<DirectClient>>({
    instagramUsername: client.instagramUsername || "",
    firstName: client.firstName || "",
    lastName: client.lastName || "",
    source: client.source || "instagram",
    statusId: client.statusId || statuses.find((s) => s.isDefault)?.id || statuses[0]?.id || "",
    masterId: client.masterId || "",
    consultationDate: client.consultationDate ? client.consultationDate.split("T")[0] : "",
    comment: client.comment || "",
  });

  useEffect(() => {
    setFormData({
      instagramUsername: client.instagramUsername || "",
      firstName: client.firstName || "",
      lastName: client.lastName || "",
      source: client.source || "instagram",
      statusId: client.statusId || statuses.find((s) => s.isDefault)?.id || statuses[0]?.id || "",
      masterId: client.masterId || "",
      consultationDate: client.consultationDate ? client.consultationDate.split("T")[0] : "",
      comment: client.comment || "",
    });
  }, [client, statuses]);

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label label-text text-xs">Instagram username *</label>
            <input
              type="text"
              className="input input-bordered input-sm w-full"
              placeholder="@username"
              value={formData.instagramUsername}
              onChange={(e) => setFormData({ ...formData, instagramUsername: e.target.value })}
              disabled={!!client.id}
            />
          </div>

          <div>
            <label className="label label-text text-xs">Джерело</label>
            <select
              className="select select-bordered select-sm w-full"
              value={formData.source}
              onChange={(e) => setFormData({ ...formData, source: e.target.value as "instagram" | "tiktok" | "other" })}
            >
              <option value="instagram">Instagram</option>
              <option value="tiktok">TikTok</option>
              <option value="other">Інше</option>
            </select>
          </div>

          <div>
            <label className="label label-text text-xs">Ім'я</label>
            <input
              type="text"
              className="input input-bordered input-sm w-full"
              value={formData.firstName}
              onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
            />
          </div>

          <div>
            <label className="label label-text text-xs">Прізвище</label>
            <input
              type="text"
              className="input input-bordered input-sm w-full"
              value={formData.lastName}
              onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
            />
          </div>

          <div>
            <label className="label label-text text-xs">Статус</label>
            <select
              className="select select-bordered select-sm w-full"
              value={formData.statusId}
              onChange={(e) => setFormData({ ...formData, statusId: e.target.value })}
            >
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {formData.statusId === "consultation" && (
            <div>
              <label className="label label-text text-xs">Відповідальний</label>
              <select
                className="select select-bordered select-sm w-full"
                value={formData.masterId || ""}
                onChange={(e) => setFormData({ ...formData, masterId: e.target.value || undefined })}
              >
                <option value="">-</option>
                {/* Фільтруємо тільки майстрів (role='master'), не адміністраторів та дірект-менеджерів */}
                {masters.filter((m: any) => !m.role || m.role === 'master').map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="label label-text text-xs">Дата консультації</label>
            <input
              type="date"
              className="input input-bordered input-sm w-full"
              value={formData.consultationDate}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  consultationDate: e.target.value ? `${e.target.value}T00:00:00.000Z` : undefined,
                })
              }
            />
          </div>

          <div className="md:col-span-2">
            <label className="label label-text text-xs">Коментар</label>
            <textarea
              className="textarea textarea-bordered textarea-sm w-full"
              rows={3}
              value={formData.comment}
              onChange={(e) => setFormData({ ...formData, comment: e.target.value })}
              placeholder="Нотатки про клієнта..."
            />
          </div>
        </div>

      <div className="flex gap-2 mt-4">
        <button className="btn btn-sm btn-primary" onClick={() => onSave(formData)}>
          Зберегти
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onCancel}>
          Скасувати
        </button>
      </div>
    </div>
  );
}
