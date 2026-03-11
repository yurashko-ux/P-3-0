// web/app/admin/direct/_components/BinotelCallHistoryModal.tsx
// Модальне вікно історії дзвінків Binotel по клієнту

"use client";

import { useState, useEffect } from "react";
import type { DirectClient } from "@/lib/direct-types";
import { PlayRecordingButton } from "./PlayRecordingButton";

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
}

function formatCallType(type: string): string {
  return type === "incoming" ? "Вхідний" : "Вихідний";
}

function formatDisposition(d: string): string {
  if (d === "ANSWER") return "Успішний";
  return d || "—";
}

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

export function BinotelCallHistoryModal({
  client,
  isOpen,
  onClose,
}: BinotelCallHistoryModalProps) {
  const [calls, setCalls] = useState<BinotelCall[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !client?.id) {
      setCalls([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/admin/direct/clients/${client.id}/binotel-calls`)
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
  }, [isOpen, client?.id]);

  if (!isOpen) return null;

  const name = client
    ? [client.firstName, client.lastName].filter(Boolean).join(" ") || client.instagramUsername
    : "—";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b flex justify-between items-center">
          <h3 className="font-semibold">Історія дзвінків Binotel — {name}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            ✕
          </button>
        </div>
        <div className="p-4 overflow-y-auto flex-1">
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
                >
                  <span className="flex flex-wrap gap-2">
                    <span className="font-medium">{formatDateTime(c.startTime)}</span>
                    <span>{formatCallType(c.callType)}</span>
                    <span
                      className={
                        c.disposition === "ANSWER"
                          ? "text-green-600"
                          : "text-amber-600"
                      }
                    >
                      {formatDisposition(c.disposition)}
                    </span>
                    <span>{formatDuration(c.durationSec)}</span>
                  </span>
                  {(c.recordingUrl || c.generalCallID) ? (
                    <PlayRecordingButton
                      recordingUrl={c.recordingUrl}
                      generalCallID={c.generalCallID}
                      title="Прослухати запис"
                      className="text-blue-600 hover:text-blue-800 ml-auto"
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
