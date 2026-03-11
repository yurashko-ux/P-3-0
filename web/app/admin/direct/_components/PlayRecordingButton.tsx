// web/app/admin/direct/_components/PlayRecordingButton.tsx
// Кнопка прослуховування запису Binotel: відкриває URL напряму або отримує через stats/call-record

"use client";

import { useState } from "react";

interface PlayRecordingButtonProps {
  recordingUrl?: string | null;
  generalCallID?: string | null;
  title?: string;
  className?: string;
  /** Якщо задано — відкривати плеєр внутрішньо замість нової вкладки */
  onPlayRequest?: (url: string) => void;
}

export function PlayRecordingButton({
  recordingUrl,
  generalCallID,
  title = "Прослухати запис",
  className = "text-blue-600 hover:text-blue-800",
  onPlayRequest,
}: PlayRecordingButtonProps) {
  const [loading, setLoading] = useState(false);

  const openUrl = (u: string) => {
    if (onPlayRequest) {
      onPlayRequest(u);
    } else {
      window.open(u, "_blank", "noopener,noreferrer");
    }
  };

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (recordingUrl) {
      openUrl(recordingUrl);
      return;
    }
    if (generalCallID) {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/admin/binotel/call-record?generalCallID=${encodeURIComponent(generalCallID)}`
        );
        const data = await res.json();
        if (data.ok && data.url) {
          openUrl(data.url);
        } else {
          alert(data.error || "Не вдалося отримати запис");
        }
      } catch {
        alert("Помилка мережі");
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={`${className} disabled:opacity-50`}
      title={title}
    >
      {loading ? "…" : "▶"}
    </button>
  );
}
