"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatDateDDMMYY } from "../../_components/direct-client-table-formatters";
import { InactiveBaseCampaignAudienceBadges } from "./InactiveBaseCampaignAudienceBadges";
import { InactiveBaseTelegramCounterPills } from "./InactiveBaseTelegramCounterPills";
import { renderCampaignBody } from "@/lib/inactive-base/campaign-template";
import {
  DEFAULT_CAMPAIGN_BODY,
  clearPendingCampaignClientIds,
  notifyCampaignsChanged,
  parseCampaignChannels,
  readPendingCampaignClientIds,
  readSelectedCampaignId,
  writeSelectedCampaignId,
  type InactiveBaseCampaign,
} from "./inactive-base-campaigns-shared";

type View = "list" | "form";

export function InactiveBaseCampaignsPanel() {
  const searchParams = useSearchParams();
  const [view, setView] = useState<View>("list");
  const [items, setItems] = useState<InactiveBaseCampaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState(DEFAULT_CAMPAIGN_BODY);
  const [channels, setChannels] = useState<string[]>(["instagram", "telegram"]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [pendingClientIds, setPendingClientIds] = useState<string[]>([]);
  const [sendingCampaignId, setSendingCampaignId] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);

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
    setSelectedCampaignId(readSelectedCampaignId());
    void load();
  }, [load]);

  const selectCampaign = (id: string) => {
    setSelectedCampaignId(id);
    writeSelectedCampaignId(id);
  };

  const openNewForm = (clientIds?: string[]) => {
    setEditingId(null);
    setName("");
    setBodyTemplate(DEFAULT_CAMPAIGN_BODY);
    setChannels(["instagram", "telegram"]);
    setPendingClientIds(clientIds ?? readPendingCampaignClientIds());
    setError(null);
    setView("form");
  };

  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    const ids = readPendingCampaignClientIds();
    openNewForm(ids.length > 0 ? ids : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- лише при ?new=1
  }, [searchParams]);

  useEffect(() => {
    const id = searchParams.get("campaignId")?.trim();
    if (!id || items.length === 0) return;
    if (items.some((c) => c.id === id)) {
      setSelectedCampaignId(id);
      writeSelectedCampaignId(id);
    }
  }, [searchParams, items]);

  useEffect(() => {
    if (view !== "form" || editingId) return;
    const ids = readPendingCampaignClientIds();
    if (ids.length > 0) setPendingClientIds(ids);
  }, [view, editingId]);

  const openEditForm = (c: InactiveBaseCampaign) => {
    setEditingId(c.id);
    setName(c.name);
    setBodyTemplate(c.bodyTemplate);
    setChannels(parseCampaignChannels(c.channels));
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
      const payload: Record<string, unknown> = {
        name: name.trim(),
        bodyTemplate: bodyTemplate.trim(),
        channels,
      };
      if (!editingId && pendingClientIds.length > 0) {
        payload.clientIds = pendingClientIds;
      }
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
      if (!editingId) {
        clearPendingCampaignClientIds();
        setPendingClientIds([]);
        notifyCampaignsChanged();
      }
      await load();
      if (data.item?.id) selectCampaign(data.item.id);
      setView("list");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const sendCampaign = async (c: InactiveBaseCampaign) => {
    const audience = c.telegramAudienceCount ?? c.clientCount ?? 0;
    const withTg = c.telegramWithChatIdCount ?? 0;
    if (
      !confirm(
        `Відправити кампанію «${c.name}» у Telegram?\n\nКлієнтів у групі: ${audience}\nЗ Telegram: ${withTg}\nБез Telegram (будуть пропущені): ${c.telegramWithoutChatIdCount ?? audience - withTg}`
      )
    ) {
      return;
    }
    setSendingCampaignId(c.id);
    setError(null);
    setSendSuccess(null);
    try {
      const res = await fetch(
        `/api/admin/direct/inactive-base/campaigns/${encodeURIComponent(c.id)}/send`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: "telegram", sendAllAudience: true }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const stats = data.stats as {
        sent?: number;
        failed?: number;
        skipped?: number;
        selected?: number;
      };
      setSendSuccess(
        `Відправлено: ${stats.sent ?? 0}, помилок: ${stats.failed ?? 0}, пропущено: ${stats.skipped ?? 0}`
      );
      await load();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("inactive-base:reload-clients"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSendingCampaignId(null);
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
      if (selectedCampaignId === id) {
        setSelectedCampaignId(null);
        writeSelectedCampaignId(null);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const preview = renderCampaignBody(bodyTemplate, { firstName: "Олена", lastName: "Коваленко" });

  return (
    <div className="min-h-screen bg-base-200">
      <div className="max-w-lg mx-auto min-h-screen bg-base-100 shadow-sm flex flex-col">
        {view === "list" ? (
          <>
            <div className="flex items-center gap-2 border-b border-base-300 px-4 py-3 shrink-0">
              <Link href="/admin/direct/inactive-base" className="btn btn-sm btn-ghost px-2" title="Не Активна база">
                ←
              </Link>
              <h1 className="font-bold text-lg flex-1">Кампанії</h1>
            </div>

            <p className="px-4 pt-3 pb-2 text-[11px] text-base-content/60 shrink-0">
              Нову кампанію створюйте з таблиці «Не Активна база» (виділіть клієнтів → «Створити кампанію»). Клік по
              назві — обрати для копіювання текстів.
            </p>

            {error ? (
              <div className="px-4 pb-2 shrink-0">
                <div className="alert alert-error text-sm py-2">
                  <span>{error}</span>
                </div>
              </div>
            ) : null}
            {sendSuccess ? (
              <div className="px-4 pb-2 shrink-0">
                <div className="alert alert-success text-sm py-2">
                  <span>{sendSuccess}</span>
                </div>
              </div>
            ) : null}

            <div className="flex-1 overflow-y-auto px-4 pb-6 min-h-0">
              {loading ? (
                <div className="py-12 text-center text-sm opacity-70">Завантаження…</div>
              ) : items.length === 0 ? (
                <div className="py-12 text-center text-sm text-base-content/60">
                  Ще немає кампаній. Виділіть клієнтів у «Не Активна база» і натисніть «Створити кампанію».
                </div>
              ) : (
                <ul className="space-y-2">
                  {items.map((c) => {
                    const isSelected = selectedCampaignId === c.id;
                    const ch = parseCampaignChannels(c.channels);
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
                            onClick={() => selectCampaign(c.id)}
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
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-base-content/60">
                          <span>Створено: {formatDateDDMMYY(c.createdAt)}</span>
                          {(c.clientCount ?? 0) > 0 ? (
                            <Link
                              href={`/admin/direct/inactive-base?campaignId=${encodeURIComponent(c.id)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="link link-primary font-medium tabular-nums"
                              title={`${c.clientCount} клієнтів, ${c.respondedCount ?? 0} відповіли (після додавання в кампанію)`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {c.clientCount}/{c.respondedCount ?? 0}
                            </Link>
                          ) : (
                            <span className="tabular-nums">0/0</span>
                          )}
                          {ch.includes("telegram") ? (
                            <InactiveBaseCampaignAudienceBadges
                              counts={{
                                total: c.telegramAudienceCount ?? c.clientCount ?? 0,
                                activated: c.telegramWithChatIdCount ?? 0,
                                nonActivated:
                                  c.telegramWithoutChatIdCount ??
                                  Math.max(
                                    0,
                                    (c.telegramAudienceCount ?? c.clientCount ?? 0) -
                                      (c.telegramWithChatIdCount ?? 0)
                                  ),
                              }}
                            />
                          ) : null}
                          {ch.includes("telegram") ? (
                            <InactiveBaseTelegramCounterPills
                              counts={{
                                outgoingManualCount: c.telegramActiveManualCount ?? 0,
                                outgoingSystemCount: c.telegramActiveSystemCount ?? 0,
                                incomingCount: c.telegramActiveIncomingCount ?? 0,
                              }}
                            />
                          ) : null}
                        </div>
                        <p className="text-[11px] text-base-content/60 mt-1 line-clamp-3">{c.bodyTemplate}</p>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {ch.map((x) => (
                            <span key={x} className="badge badge-xs badge-ghost">
                              {x === "instagram" ? "Instagram" : "Telegram"}
                            </span>
                          ))}
                        </div>
                        {c.hasTelegramChannel !== false && ch.includes("telegram") ? (
                          <div className="mt-2">
                            <button
                              type="button"
                              className="btn btn-xs btn-primary"
                              disabled={!c.telegramCanSend || sendingCampaignId === c.id}
                              title={
                                c.telegramCanSend
                                  ? `${c.telegramWithChatIdCount ?? 0} з ${c.telegramAudienceCount ?? c.clientCount ?? 0} мають Telegram`
                                  : (c.clientCount ?? 0) === 0
                                    ? "У кампанії немає клієнтів"
                                    : "Жоден клієнт не має Telegram (telegramChatId)"
                              }
                              onClick={() => void sendCampaign(c)}
                            >
                              {sendingCampaignId === c.id ? (
                                <span className="loading loading-spinner loading-xs" />
                              ) : (
                                "Відправити"
                              )}
                            </button>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-base-300 px-4 py-3 shrink-0">
              <button type="button" className="btn btn-sm btn-ghost px-2" onClick={backToList}>
                ←
              </button>
              <h1 className="font-bold text-lg flex-1 truncate">
                {editingId ? "Редагувати кампанію" : "Нова кампанія"}
              </h1>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
              {!editingId && pendingClientIds.length > 0 ? (
                <div className="text-xs bg-primary/10 border border-primary/20 rounded-lg px-3 py-2">
                  Клієнтів у кампанії: <span className="font-semibold">{pendingClientIds.length}</span>
                </div>
              ) : null}
              {!editingId && pendingClientIds.length === 0 ? (
                <div className="alert alert-warning text-xs py-2">
                  <span>
                    Немає виділених клієнтів. Поверніться на вкладку «Не Активна база», виділіть клієнтів і знову
                    натисніть «Створити кампанію».
                  </span>
                </div>
              ) : null}
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
                  className="textarea textarea-bordered textarea-sm w-full mt-1 min-h-[160px]"
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
              <button
                type="button"
                className="btn btn-sm btn-primary flex-1"
                disabled={saving || (!editingId && pendingClientIds.length === 0)}
                onClick={() => void save()}
              >
                {saving ? "…" : editingId ? "Зберегти" : "Створити"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
