"use client";

import { useCallback, useEffect, useState } from "react";
import { renderCampaignBody } from "@/lib/inactive-base/campaign-template";

export type InactiveBaseCampaign = {
  id: string;
  name: string;
  bodyTemplate: string;
  channels: string[] | unknown;
  createdAt: string;
  updatedAt: string;
  runs?: Array<{
    id: string;
    channel: string;
    startedAt: string;
    sentCount: number;
    failedCount: number;
    skippedCount: number;
    selectedCount: number;
  }>;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onCampaignsChange: () => void;
  selectedCampaignId: string | null;
  onSelectCampaignId: (id: string | null) => void;
};

function parseChannels(ch: unknown): string[] {
  if (!Array.isArray(ch)) return ["instagram", "telegram"];
  return ch.filter((x) => x === "instagram" || x === "telegram") as string[];
}

export function InactiveBaseCampaignsModal({
  isOpen,
  onClose,
  onCampaignsChange,
  selectedCampaignId,
  onSelectCampaignId,
}: Props) {
  const [items, setItems] = useState<InactiveBaseCampaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("Привіт, {{ПІБ}}! Давно не бачились у салоні…");
  const [channels, setChannels] = useState<string[]>(["instagram", "telegram"]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/direct/inactive-base/campaigns", { credentials: "include", cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setBodyTemplate("Привіт, {{ПІБ}}! Давно не бачились у салоні…");
    setChannels(["instagram", "telegram"]);
  };

  const startEdit = (c: InactiveBaseCampaign) => {
    setEditingId(c.id);
    setName(c.name);
    setBodyTemplate(c.bodyTemplate);
    setChannels(parseChannels(c.channels));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = { name: name.trim(), bodyTemplate: bodyTemplate.trim(), channels };
      const url = editingId
        ? `/api/admin/direct/inactive-base/campaigns/${encodeURIComponent(editingId)}`
        : "/api/admin/direct/inactive-base/campaigns";
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Помилка збереження");
      resetForm();
      await load();
      onCampaignsChange();
      if (data.item?.id) onSelectCampaignId(data.item.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Видалити кампанію?")) return;
    try {
      const res = await fetch(`/api/admin/direct/inactive-base/campaigns/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Помилка видалення");
      if (selectedCampaignId === id) onSelectCampaignId(null);
      await load();
      onCampaignsChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const preview = renderCampaignBody(bodyTemplate, { firstName: "Олена", lastName: "Коваленко" });

  if (!isOpen) return null;

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-3xl max-h-[90vh] overflow-y-auto">
        <h3 className="font-bold text-lg mb-2">Кампанії — Неактивна база</h3>
        <p className="text-xs text-base-content/70 mb-4">
          Плейсхолдери: {"{{ПІБ}}"}, {"{{імя}}"}, {"{{прізвище}}"}
        </p>

        {error && (
          <div className="alert alert-error text-sm mb-3">
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="space-y-2">
            <label className="text-xs font-medium">Назва</label>
            <input className="input input-bordered input-sm w-full" value={name} onChange={(e) => setName(e.target.value)} />
            <label className="text-xs font-medium">Текст</label>
            <textarea
              className="textarea textarea-bordered textarea-sm w-full min-h-[120px]"
              value={bodyTemplate}
              onChange={(e) => setBodyTemplate(e.target.value)}
            />
            <div className="flex flex-wrap gap-2 text-xs">
              <label className="label cursor-pointer gap-1 py-0">
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs"
                  checked={channels.includes("instagram")}
                  onChange={(e) =>
                    setChannels((prev) =>
                      e.target.checked ? [...new Set([...prev, "instagram"])] : prev.filter((c) => c !== "instagram")
                    )
                  }
                />
                Instagram
              </label>
              <label className="label cursor-pointer gap-1 py-0">
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs"
                  checked={channels.includes("telegram")}
                  onChange={(e) =>
                    setChannels((prev) =>
                      e.target.checked ? [...new Set([...prev, "telegram"])] : prev.filter((c) => c !== "telegram")
                    )
                  }
                />
                Telegram
              </label>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn btn-sm btn-primary" disabled={saving} onClick={() => void save()}>
                {saving ? "…" : editingId ? "Зберегти" : "Створити"}
              </button>
              {editingId ? (
                <button type="button" className="btn btn-sm btn-ghost" onClick={resetForm}>
                  Скасувати
                </button>
              ) : null}
            </div>
            <div className="text-xs bg-base-200 rounded p-2">
              <div className="font-medium mb-1">Превʼю:</div>
              <div className="whitespace-pre-wrap">{preview}</div>
            </div>
          </div>

          <div>
            <div className="text-xs font-medium mb-2">Збережені кампанії</div>
            {loading ? (
              <span className="text-sm opacity-70">Завантаження…</span>
            ) : items.length === 0 ? (
              <span className="text-sm opacity-70">Ще немає кампаній</span>
            ) : (
              <ul className="space-y-2 max-h-[360px] overflow-y-auto">
                {items.map((c) => (
                  <li key={c.id} className="border border-base-300 rounded-lg p-2 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        className={`text-left font-medium hover:underline ${selectedCampaignId === c.id ? "text-primary" : ""}`}
                        onClick={() => onSelectCampaignId(c.id)}
                      >
                        {c.name}
                      </button>
                      <div className="flex gap-1 shrink-0">
                        <button type="button" className="btn btn-xs btn-ghost" onClick={() => startEdit(c)}>
                          ✎
                        </button>
                        <button type="button" className="btn btn-xs btn-ghost text-error" onClick={() => void remove(c.id)}>
                          ✕
                        </button>
                      </div>
                    </div>
                    {c.runs && c.runs.length > 0 ? (
                      <div className="text-[10px] text-base-content/60 mt-1">
                        Останній запуск: {c.runs[0].channel}, обрано {c.runs[0].selectedCount}, надіслано {c.runs[0].sentCount},
                        пропущено {c.runs[0].skippedCount}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="modal-action">
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Закрити
          </button>
        </div>
      </div>
      <button type="button" className="modal-backdrop" aria-label="Закрити" onClick={onClose} />
    </div>
  );
}
