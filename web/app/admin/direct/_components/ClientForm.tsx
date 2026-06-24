// web/app/admin/direct/_components/ClientForm.tsx
// Форма для створення/редагування клієнта

"use client";

import { useState, useEffect } from "react";
import type { DirectClient, DirectStatus } from "@/lib/direct-types";
import { hasNormalInstagramUsername } from "@/lib/altegio/client-utils";
import { resolveDisplayInstagramUsername } from "@/lib/direct-message-handle";
import { CommunicationChannelPicker } from "./CommunicationChannelPicker";

type ClientFormProps = {
  client: Partial<DirectClient>;
  statuses: DirectStatus[];
  masters: Array<{ id: string; name: string; role?: string }>;
  onSave: (clientData: Partial<DirectClient>) => Promise<void>;
  onCancel: () => void;
};

export function ClientForm({ client, statuses, masters, onSave, onCancel }: ClientFormProps) {
  const [copiedAltegioId, setCopiedAltegioId] = useState(false);
  const [instagramFromMessages, setInstagramFromMessages] = useState<string | null>(null);
  const [instagramFromMessagesLoading, setInstagramFromMessagesLoading] = useState(false);
  const [formData, setFormData] = useState<Partial<DirectClient>>({
    instagramUsername: client.instagramUsername || "",
    firstName: client.firstName || "",
    lastName: client.lastName || "",
    source: client.source || "instagram",
    statusId: client.statusId || (client.altegioClientId ? statuses.find((s) => s.id === 'client')?.id : statuses.find((s) => s.id === 'lead')?.id) || statuses[0]?.id || "lead",
    masterId: client.masterId || "",
    consultationDate: client.consultationDate ? client.consultationDate.split("T")[0] : "",
    comment: client.comment || "",
    communicationChannel: client.communicationChannel ?? null,
  });

  useEffect(() => {
    setFormData({
      instagramUsername: client.instagramUsername || "",
      firstName: client.firstName || "",
      lastName: client.lastName || "",
      source: client.source || "instagram",
      statusId: client.statusId || (client.altegioClientId ? statuses.find((s) => s.id === 'client')?.id : statuses.find((s) => s.id === 'lead')?.id) || statuses[0]?.id || "lead",
      masterId: client.masterId || "",
      consultationDate: client.consultationDate ? client.consultationDate.split("T")[0] : "",
      comment: client.comment || "",
      communicationChannel: client.communicationChannel ?? null,
    });
    setInstagramFromMessages(null);
  }, [client, statuses]);

  useEffect(() => {
    if (!client.id) return;

    let cancelled = false;
    setInstagramFromMessagesLoading(true);

    void fetch(
      `/api/admin/direct/clients/${encodeURIComponent(client.id)}?includeMessageInstagram=1`,
      { credentials: "include", cache: "no-store" }
    )
      .then((res) => res.json())
      .then((data: {
        ok?: boolean;
        instagramFromMessages?: string | null;
        displayInstagramUsername?: string;
      }) => {
        if (cancelled || !data?.ok) return;
        const fromMessages =
          typeof data.instagramFromMessages === "string" && data.instagramFromMessages.trim()
            ? data.instagramFromMessages.trim()
            : null;
        setInstagramFromMessages(fromMessages);

        const display =
          (typeof data.displayInstagramUsername === "string" && data.displayInstagramUsername.trim()) ||
          resolveDisplayInstagramUsername(client.instagramUsername, fromMessages);

        if (
          fromMessages &&
          !hasNormalInstagramUsername(client.instagramUsername) &&
          display === fromMessages
        ) {
          setFormData((prev) => ({ ...prev, instagramUsername: fromMessages }));
        }
      })
      .catch((err) => {
        console.warn("[ClientForm] includeMessageInstagram:", err);
      })
      .finally(() => {
        if (!cancelled) setInstagramFromMessagesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client.id, client.instagramUsername]);

  const storedTechnical = !hasNormalInstagramUsername(client.instagramUsername);
  const showMessageInstagramHint =
    storedTechnical && instagramFromMessages && instagramFromMessages !== (client.instagramUsername || "").trim();

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
              title={client.id ? "Можна змінити; новий username має бути унікальним у Direct" : undefined}
            />
            {client.id ? (
              <p className="text-[11px] text-base-content/60 mt-1">
                Зміна Instagram username збережеться в Direct; нік не повинен збігатися з іншим клієнтом.
              </p>
            ) : null}
            {instagramFromMessagesLoading && client.id ? (
              <p className="text-[11px] text-base-content/50 mt-1">Перевірка переписки…</p>
            ) : null}
            {showMessageInstagramHint ? (
              <p className="text-[11px] text-info mt-1">
                З переписки ManyChat: @{instagramFromMessages}
                {storedTechnical ? " — підставлено в поле; збережіть, щоб оновити картку." : ""}
              </p>
            ) : null}
            {client.id && storedTechnical && !instagramFromMessagesLoading && !instagramFromMessages ? (
              <p className="text-[11px] text-base-content/50 mt-1">
                У збереженій перепискі не знайдено реальний Instagram handle.
              </p>
            ) : null}
          </div>

          <div>
            <label className="label label-text text-xs">Altegio ID</label>
            <div className="flex gap-1 items-center">
              <input
                type="text"
                className="input input-bordered input-sm flex-1"
                value={client.altegioClientId ?? ""}
                readOnly
                placeholder="Не зіставлено"
              />
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                title="Скопіювати"
                disabled={client.altegioClientId == null}
                onClick={async () => {
                  const value = String(client.altegioClientId ?? "");
                  if (value && typeof navigator?.clipboard?.writeText === "function") {
                    await navigator.clipboard.writeText(value);
                    setCopiedAltegioId(true);
                    setTimeout(() => setCopiedAltegioId(false), 1500);
                  }
                }}
              >
                {copiedAltegioId ? "Скопійовано" : "Скопіювати"}
              </button>
            </div>
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
            <label className="label label-text text-xs">Комунікація</label>
            <div className="flex items-center">
              <CommunicationChannelPicker
                size="form"
                value={formData.communicationChannel}
                onChange={(next) =>
                  setFormData({
                    ...formData,
                    communicationChannel: next,
                  })
                }
              />
            </div>
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
