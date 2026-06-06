"use client";

import { useEffect, useRef, useState } from "react";
import {
  hasNormalInstagramUsername,
  isTechnicalDirectInstagramUsername,
} from "@/lib/altegio/client-utils";
import { normalizeInstagram } from "@/lib/normalize";

function igUrl(username: string): string {
  const u = (username || "").replace(/^@/, "").trim();
  return u ? `https://www.instagram.com/${encodeURIComponent(u)}/` : "#";
}

type Props = {
  clientId: string;
  instagramUsername: string;
};

export function InactiveBaseInstagramUsernameCell({ clientId, instagramUsername }: Props) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const display = instagramUsername.replace(/^@/, "").trim();
  const isReal = hasNormalInstagramUsername(instagramUsername);
  const isTechnical = isTechnicalDirectInstagramUsername(instagramUsername);

  useEffect(() => {
    if (editing) {
      setValue("");
      setError(null);
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [editing]);

  const handleSave = async () => {
    const normalized = normalizeInstagram(value);
    if (!normalized) {
      setError("Введіть коректний Instagram username");
      return;
    }
    if (!hasNormalInstagramUsername(normalized)) {
      setError("Це технічний username — введіть реальний Instagram клієнта");
      return;
    }
    if (normalized === display.toLowerCase()) {
      setError("Новий username збігається з поточним");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/direct/clients/${encodeURIComponent(clientId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instagramUsername: normalized,
          _fallbackInstagram: instagramUsername,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        client?: { instagramUsername?: string };
      };
      if (!res.ok || !data.ok) {
        setError(data.error || `Не вдалося зберегти (HTTP ${res.status})`);
        return;
      }
      setEditing(false);
      window.dispatchEvent(new CustomEvent("inactive-base:reload-clients"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (isReal) {
    return (
      <a
        href={igUrl(instagramUsername)}
        target="_blank"
        rel="noopener noreferrer"
        className="link link-primary"
        onClick={(e) => e.stopPropagation()}
      >
        @{display}
      </a>
    );
  }

  if (!isTechnical) {
    return <span className="text-base-content/50">@{display || "—"}</span>;
  }

  return (
    <>
      <button
        type="button"
        className="link link-warning text-left"
        title="Ввести реальний Instagram клієнта"
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        @{display}
      </button>

      {editing ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
          onClick={(e) => {
            e.stopPropagation();
            if (!saving) setEditing(false);
          }}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !saving) setEditing(false);
            }}
          >
            <div className="p-4 border-b border-base-300">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-bold text-base">Ввести Instagram клієнта</h3>
                <button
                  type="button"
                  className="btn btn-sm btn-circle btn-ghost"
                  disabled={saving}
                  onClick={() => setEditing(false)}
                  aria-label="Закрити"
                >
                  ✕
                </button>
              </div>
              <p className="text-xs text-base-content/60 mt-1">
                Зараз технічний username: <span className="font-mono">@{display}</span>
              </p>
            </div>

            <div className="p-4 space-y-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-base-content/70">Реальний Instagram</span>
                <input
                  ref={inputRef}
                  type="text"
                  className="input input-bordered input-sm w-full"
                  placeholder="@username"
                  value={value}
                  disabled={saving}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleSave();
                    }
                  }}
                />
              </label>
              <p className="text-[11px] text-base-content/60">
                Збережеться в картці клієнта Direct і в цій таблиці.
              </p>
              {error ? <p className="text-sm text-error whitespace-pre-wrap">{error}</p> : null}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={saving}
                  onClick={() => setEditing(false)}
                >
                  Скасувати
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={saving}
                  onClick={() => void handleSave()}
                >
                  {saving ? <span className="loading loading-spinner loading-xs" /> : null}
                  Зберегти
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
