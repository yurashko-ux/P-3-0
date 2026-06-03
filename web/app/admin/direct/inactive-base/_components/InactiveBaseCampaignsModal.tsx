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

type View = "list" | "form";

function parseChannels(ch: unknown): string[] {
  if (!Array.isArray(ch)) return ["instagram", "telegram"];
  return ch.filter((x) => x === "instagram" || x === "telegram") as string[];
}

const DEFAULT_BODY = "Привіт, {{ПІБ}}! Давно не бачились у салоні…";

export function InactiveBaseCampaignsModal({
  isOpen,
  onClose,
  onCampaignsChange,
  selectedCampaignId,
  onSelectCampaignId,
}: Props) {
  const [view, setView] = useState<View>("list");
  const [items, setItems] = useState<InactiveBaseCampaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState(DEFAULT_BODY);
  const [channels, setChannels] = useState<string[]>(["instagram", "telegram"]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/direct/inactive-base/campaigns", {
        credentials: "include",
        cache: "no-store",
      });
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
    if (isOpen) {
      setView("list");
      setError(null);
      void load();
    }
  }, [isOpen, load]);

  const openNewForm = () => {
    setEditingId(null);
    setName("");
    setBodyTemplate(DEFAULT_BODY);
    setChannels(["instagram", "telegram"]);
    setError(null);
    setView("form");
  };

  const openEditForm = (c: InactiveBaseCampaign) => {
    setEditingId(c.id);
    setName(c.name);
    setBodyTemplate(c.bodyTemplate);
    setChannels(parseChannels(c.channels));
    setError(null);
    setView("form");
  };

  const backToList = () => {
    setView("list");
    setError(null);
  };

  const save = async () => {
    if (!name.trim()) {
      setError("Вкажіть назву кампанії");
      return;
    }
    if (!bodyTemplate.trim()) {
      setError("Вкажіть текст кампанії");
      return;
    }
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
      await load();
      onCampaignsChange();
      if (data.item?.id) onSelectCampaignId(data.item.id);
      setView("list");
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
      <div className="modal-box max-w-lg max-h-[90vh] flex flex-col p-0 overflow-hidden">
        {view === "list" ? (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-base-300 px-4 py-3 shrink-0">
              <h3 className="font-bold text-lg">Кампанії</h3>
              <button type="button" className="btn btn-sm btn-circle btn-ghost" onClick={onClose} aria-label="Закрити">
                ✕
              </button>
            </div>

            <div className="px-4 pt-3 pb-2 shrink-0">
              <button type="button" className="btn btn-sm btn-primary w-full" onClick={openNewForm}>
                + Нова кампанія
              </button>
            </div>

            {error ? (
              <div className="px-4 pb-2 shrink-0">
                <div className="alert alert-error text-sm py-2">
                  <span>{error}</span>
                </div>
              </div>
            ) : null}

            <div className="flex-1 overflow-y-auto px-4 pb-4 min-h-0">
              {loading ? (
                <div className="py-8 text-center text-sm opacity-70">Завантаження…</div>
              ) : items.length === 0 ? (
                <div className="py-8 text-center text-sm text-base-content/60">
                  Ще немає кампаній. Натисніть «+ Нова кампанія».
                </div>
              ) : (
                <ul className="space-y-2">
                  {items.map((c) => {
                    const isSelected = selectedCampaignId === c.id;
                    const ch = parseChannels(c.channels);
                    return (
                      <li
                        key={c.id}
                        className={`border rounded-lg p-3 text-sm transition-colors ${
                          isSelected ? "border-primary bg-primary/5" : "border-base-300"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            className="text-left font-medium hover:underline flex-1 min-w-0"
                            onClick={() => onSelectCampaignId(c.id)}
                            title="Обрати для копіювання текстів у таблиці"
                          >
                            {c.name}
                            {isSelected ? (
                              <span className="ml-1 text-[10px] text-primary font-normal">(обрана)</span>
                            ) : null}
                          </button>
                          <div className="flex gap-0.5 shrink-0">
                            <button
                              type="button"
                              className="btn btn-xs btn-ghost"
                              title="Редагувати"
                              onClick={() => openEditForm(c)}
                            >
                              ✎
                            </button>
                            <button
                              type="button"
                              className="btn btn-xs btn-ghost text-error"
                              title="Видалити"
                              onClick={() => void remove(c.id)}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                        <p className="text-[11px] text-base-content/60 mt-1 line-clamp-2">{c.bodyTemplate}</p>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {ch.map((x) => (
                            <span key={x} className="badge badge-xs badge-ghost">
                              {x === "instagram" ? "Instagram" : "Telegram"}
                            </span>
                          ))}
                        </div>
                        {c.runs && c.runs.length > 0 ? (
                          <div className="text-[10px] text-base-content/50 mt-1">
                            Останній запуск: {c.runs[0].selectedCount} клієнтів
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="border-t border-base-300 px-4 py-3 shrink-0">
              <button type="button" className="btn btn-sm btn-ghost w-full" onClick={onClose}>
                Закрити
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-base-300 px-4 py-3 shrink-0">
              <button type="button" className="btn btn-sm btn-ghost px-2" onClick={backToList}>
                ←
              </button>
              <h3 className="font-bold text-lg flex-1 truncate">
                {editingId ? "Редагувати кампанію" : "Нова кампанія"}
              </h3>
              <button type="button" className="btn btn-sm btn-circle btn-ghost" onClick={onClose} aria-label="Закрити">
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
              <p className="text-xs text-base-content/70">
                Плейсхолдери: {"{{ПІБ}}"}, {"{{імя}}"}, {"{{прізвище}}"}
              </p>

              {error ? (
                <div className="alert alert-error text-sm py-2">
                  <span>{error}</span>
                </div>
              ) : null}

              <div>
                <label className="text-xs font-medium">Назва</label>
                <input
                  className="input input-bordered input-sm w-full mt-1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Назва кампанії"
                />
              </div>

              <div>
                <label className="text-xs font-medium">Текст</label>
                <textarea
                  className="textarea textarea-bordered textarea-sm w-full mt-1 min-h-[140px]"
                  value={bodyTemplate}
                  onChange={(e) => setBodyTemplate(e.target.value)}
                />
              </div>

              <div className="flex flex-wrap gap-3 text-xs">
                <label className="label cursor-pointer gap-2 py-0">
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
                <label className="label cursor-pointer gap-2 py-0">
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

              <div className="text-xs bg-base-200 rounded-lg p-3">
                <div className="font-medium mb-1">Превʼю</div>
                <div className="whitespace-pre-wrap text-base-content/80">{preview}</div>
              </div>
            </div>

            <div className="border-t border-base-300 px-4 py-3 flex gap-2 shrink-0">
              <button type="button" className="btn btn-sm btn-ghost flex-1" onClick={backToList}>
                Скасувати
              </button>
              <button type="button" className="btn btn-sm btn-primary flex-1" disabled={saving} onClick={() => void save()}>
                {saving ? "…" : editingId ? "Зберегти" : "Створити"}
              </button>
            </div>
          </>
        )}
      </div>
      <button type="button" className="modal-backdrop" aria-label="Закрити" onClick={onClose} />
    </div>
  );
}
