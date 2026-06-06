// web/app/admin/direct/_components/BinotelCallHistoryModal.tsx
// Модальне вікно історії дзвінків Binotel по клієнту

"use client";

import { useState, useEffect, useCallback } from "react";
import type { DirectCallStatus, DirectClient } from "@/lib/direct-types";
import { BinotelCallTypeIcon } from "./BinotelCallTypeIcon";
import { PlayRecordingButton } from "./PlayRecordingButton";
import { ChatBadgeIcon, CHAT_BADGE_KEYS } from "./ChatBadgeIcon";

interface BinotelCall {
  id: string;
  generalCallID?: string;
  callType: string;
  disposition: string;
  durationSec: number | null;
  startTime: string;
  externalNumber: string;
  recordingUrl?: string | null;
}

interface BinotelCallHistoryModalProps {
  client: DirectClient | null;
  isOpen: boolean;
  onClose: () => void;
  /** Якщо задано — відкривати плеєр внутрішньо замість нової вкладки */
  onPlayRequest?: (url: string) => void;
  /** Дозвіл прослуховування записів (право callsListen). false = кнопки ▶ не відкривають плеєр */
  canListenCalls?: boolean;
  /** Показати панель вибору статусу дзвінків */
  showCallStatusPanel?: boolean;
  onCallStatusUpdated?: () => void;
}

const NEW_STATUS_NAME_MAX_LEN = 24;

function formatDuration(sec: number | null): string {
  if (sec == null || sec < 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m} хв ${s} с` : `${s} с`;
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString("uk-UA", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat("uk-UA", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    }).format(d);
  } catch {
    return iso;
  }
}

export function BinotelCallHistoryModal({
  client,
  isOpen,
  onClose,
  onPlayRequest,
  canListenCalls = true,
  showCallStatusPanel = false,
  onCallStatusUpdated,
}: BinotelCallHistoryModalProps) {
  const [calls, setCalls] = useState<BinotelCall[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [callStatuses, setCallStatuses] = useState<DirectCallStatus[]>([]);
  const [callStatusLogs, setCallStatusLogs] = useState<Array<{ statusName: string; changedAt: string }>>([]);
  const [selectedCallStatusId, setSelectedCallStatusId] = useState<string | null>(null);
  const [callStatusLoading, setCallStatusLoading] = useState(false);
  const [callStatusError, setCallStatusError] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState(false);
  const [newStatusName, setNewStatusName] = useState("");
  const [newStatusBadgeKey, setNewStatusBadgeKey] = useState("badge_1");

  const loadCalls = useCallback(() => {
    if (!client?.id) return;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/direct/clients/${client.id}/binotel-calls`, { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.calls)) {
          setCalls(data.calls);
        } else {
          setError(data.error || "Помилка завантаження");
        }
      })
      .catch((e) => {
        setError(e?.message || "Помилка мережі");
      })
      .finally(() => setLoading(false));
  }, [client?.id]);

  const loadCallStatusPanel = useCallback(async () => {
    if (!client?.id || !showCallStatusPanel) return;
    setCallStatusLoading(true);
    setCallStatusError(null);
    try {
      const [statusesRes, metaRes, clientRes] = await Promise.all([
        fetch("/api/admin/direct/call-statuses", { credentials: "include" }),
        fetch("/api/admin/direct/clients/communication-meta", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [client.id] }),
        }),
        fetch(`/api/admin/direct/clients/${encodeURIComponent(client.id)}`, { credentials: "include" }),
      ]);
      const statusesData = await statusesRes.json().catch(() => ({}));
      const metaData = await metaRes.json().catch(() => ({}));
      const clientData = await clientRes.json().catch(() => ({}));

      if (statusesData?.ok && Array.isArray(statusesData.statuses)) {
        setCallStatuses(statusesData.statuses);
      } else {
        setCallStatuses([]);
      }

      const cl = clientData?.client as Record<string, unknown> | undefined;
      setSelectedCallStatusId((cl?.callStatusId as string | null) ?? client.callStatusId ?? null);
      const patch = metaData?.byId?.[client.id] as
        | { callStatusLogs?: Array<{ statusName: string; changedAt: string }> }
        | undefined;
      const logs = patch?.callStatusLogs ?? [];
      setCallStatusLogs(Array.isArray(logs) ? logs : []);
    } catch (e) {
      setCallStatusError(e instanceof Error ? e.message : String(e));
    } finally {
      setCallStatusLoading(false);
    }
  }, [client?.id, client?.callStatusId, showCallStatusPanel]);

  useEffect(() => {
    if (!isOpen || !client?.id) {
      setCalls([]);
      setError(null);
      setCallStatusLogs([]);
      setCallStatusError(null);
      setCreateMode(false);
      return;
    }
    loadCalls();
    if (showCallStatusPanel) {
      setSelectedCallStatusId(client.callStatusId ?? null);
      void loadCallStatusPanel();
    }
  }, [isOpen, client?.id, showCallStatusPanel, loadCalls, loadCallStatusPanel, client?.callStatusId]);

  const setCallStatus = async (statusId: string | null) => {
    if (!client?.id) return;
    setCallStatusLoading(true);
    setCallStatusError(null);
    try {
      const res = await fetch(`/api/admin/direct/clients/${encodeURIComponent(client.id)}/call-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statusId }),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setCallStatusError(data.error || "Не вдалося зберегти статус");
        return;
      }
      setSelectedCallStatusId(statusId);
      await loadCallStatusPanel();
      onCallStatusUpdated?.();
    } catch (e) {
      setCallStatusError(e instanceof Error ? e.message : String(e));
    } finally {
      setCallStatusLoading(false);
    }
  };

  const createCallStatus = async () => {
    const name = newStatusName.trim();
    if (!name) {
      setCallStatusError("Вкажіть назву статусу");
      return;
    }
    if (name.length > NEW_STATUS_NAME_MAX_LEN) {
      setCallStatusError(`Занадто довга назва (макс. ${NEW_STATUS_NAME_MAX_LEN} символи)`);
      return;
    }
    setCallStatusLoading(true);
    setCallStatusError(null);
    try {
      const res = await fetch("/api/admin/direct/call-statuses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, badgeKey: newStatusBadgeKey, order: callStatuses.length }),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setCallStatusError(data.error || "Не вдалося створити статус");
        return;
      }
      const created = data.status as DirectCallStatus;
      setCallStatuses((prev) => [...prev, created]);
      setCreateMode(false);
      setNewStatusName("");
      setNewStatusBadgeKey("badge_1");
      await setCallStatus(created.id);
    } catch (e) {
      setCallStatusError(e instanceof Error ? e.message : String(e));
    } finally {
      setCallStatusLoading(false);
    }
  };

  if (!isOpen) return null;

  const name = client
    ? [client.firstName, client.lastName].filter(Boolean).join(" ") || client.instagramUsername
    : "—";

  const currentStatus = selectedCallStatusId
    ? callStatuses.find((s) => s.id === selectedCallStatusId) ?? null
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className={`bg-white rounded-lg shadow-xl w-full mx-4 max-h-[85vh] flex flex-col ${
          showCallStatusPanel ? "max-w-3xl" : "max-w-lg"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b flex justify-between items-center shrink-0">
          <h3 className="font-semibold">Історія дзвінків Binotel — {name}</h3>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-700" aria-label="Закрити">
            ✕
          </button>
        </div>

        <div className={`flex-1 overflow-hidden flex ${showCallStatusPanel ? "flex-row gap-0" : "flex-col"}`}>
          <div className={`p-4 overflow-y-auto ${showCallStatusPanel ? "flex-1 min-w-0 border-r" : "flex-1"}`}>
            {loading && <p className="text-gray-500">Завантаження…</p>}
            {error && <p className="text-red-600">{error}</p>}
            {!loading && !error && calls.length === 0 && (
              <p className="text-gray-500">Немає дзвінків з Binotel для цього клієнта.</p>
            )}
            {!loading && !error && calls.length > 0 && (
              <ul className="space-y-2">
                {calls.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap gap-2 text-sm py-2 border-b last:border-0 items-center justify-between"
                    title={formatDateTime(c.startTime)}
                  >
                    <span className="flex flex-wrap gap-2 items-center">
                      <span className="font-medium">{formatDateTime(c.startTime)}</span>
                      <BinotelCallTypeIcon
                        callType={c.callType}
                        success={["ANSWER", "VM-SUCCESS", "SUCCESS"].includes(c.disposition)}
                        size={18}
                      />
                      <span>{formatDuration(c.durationSec)}</span>
                    </span>
                    {(() => {
                      const isSuccess = ["ANSWER", "VM-SUCCESS", "SUCCESS"].includes(c.disposition);
                      const hasRecording = c.recordingUrl || c.generalCallID;
                      if (!hasRecording || !isSuccess) return null;
                      return (
                        <PlayRecordingButton
                          recordingUrl={c.recordingUrl}
                          generalCallID={c.generalCallID}
                          title="Прослухати запис"
                          className="text-blue-600 hover:text-blue-800 ml-auto"
                          onPlayRequest={onPlayRequest}
                          listenDisabled={!canListenCalls}
                        />
                      );
                    })()}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {showCallStatusPanel ? (
            <div className="w-[240px] shrink-0 p-4 overflow-y-auto bg-base-50">
              <div className="text-xs font-semibold text-gray-700 mb-2">Статус дзвінків</div>
              {currentStatus ? (
                <div className="inline-flex items-center gap-1 mb-3 text-sm">
                  <ChatBadgeIcon badgeKey={(currentStatus as { badgeKey?: string }).badgeKey || "badge_1"} size={16} />
                  <span className="truncate">{currentStatus.name}</span>
                </div>
              ) : (
                <p className="text-xs text-gray-400 mb-3">Статус не обрано</p>
              )}

              <div className="mb-3">
                <div className="text-[10px] font-semibold text-gray-500 mb-1">Історія</div>
                {callStatusLogs.length === 0 ? (
                  <div className="text-xs text-gray-400">Немає змін</div>
                ) : (
                  <div className="space-y-1 text-xs max-h-24 overflow-y-auto">
                    {callStatusLogs.map((log, i) => (
                      <div key={i} className="text-gray-600">
                        {log.statusName} — {formatDateShort(log.changedAt)}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {createMode ? (
                <div className="mb-3 p-2 rounded border bg-gray-50">
                  <div className="text-xs font-semibold mb-2">Новий статус</div>
                  <input
                    className="input input-xs input-bordered w-full mb-2"
                    value={newStatusName}
                    onChange={(e) => setNewStatusName(e.target.value)}
                    maxLength={NEW_STATUS_NAME_MAX_LEN}
                    placeholder="Назва"
                    disabled={callStatusLoading}
                  />
                  <div className="flex flex-wrap gap-1 mb-2">
                    {CHAT_BADGE_KEYS.map((k) => (
                      <button
                        key={k}
                        type="button"
                        className={`btn btn-xs ${newStatusBadgeKey === k ? "btn-primary" : "btn-outline"}`}
                        onClick={() => setNewStatusBadgeKey(k)}
                      >
                        <ChatBadgeIcon badgeKey={k} size={14} />
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="btn btn-xs btn-primary"
                      onClick={() => void createCallStatus()}
                      disabled={callStatusLoading || !newStatusName.trim()}
                    >
                      Створити
                    </button>
                    <button
                      type="button"
                      className="btn btn-xs"
                      onClick={() => {
                        setCreateMode(false);
                        setNewStatusName("");
                      }}
                    >
                      Скасувати
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-xs btn-ghost mb-3 w-full justify-start"
                  onClick={() => setCreateMode(true)}
                >
                  + Додати статус
                </button>
              )}

              <div className="text-[10px] font-semibold text-gray-500 mb-1">Обрати</div>
              <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                <button
                  type="button"
                  className="btn btn-xs justify-start"
                  onClick={() => void setCallStatus(null)}
                  disabled={callStatusLoading}
                >
                  Без статусу
                </button>
                {callStatuses.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`btn btn-xs justify-start ${selectedCallStatusId === s.id ? "btn-primary" : ""}`}
                    onClick={() => void setCallStatus(s.id)}
                    disabled={callStatusLoading}
                  >
                    <ChatBadgeIcon badgeKey={(s as { badgeKey?: string }).badgeKey || "badge_1"} size={14} />
                    <span className="truncate">{s.name}</span>
                  </button>
                ))}
              </div>
              {callStatusError ? <p className="text-xs text-error mt-2">{callStatusError}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
